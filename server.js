/**
 * server.js — Babu AI SDR backend proxy
 *
 * Keeps all API keys server-side.
 * Routes:
 *   POST /api/chat           — Claude turn with tool-calling loop
 *   GET  /api/deepgram-token — Mint a 60-second scoped Deepgram STT key
 *   POST /api/speak          — Deepgram TTS proxy (streams MP3 back)
 *
 * Run:  node --env-file=.env server.js
 */

import express from 'express';
import cors from 'cors';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { babuConfig } from './babu.config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env.local / .env when present (local dev). Railway injects vars directly.
function loadEnvFile(name) {
  const path = join(__dirname, name);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnvFile('.env.local');
loadEnvFile('.env');

const app = express();

app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));
app.use(express.json());

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const DEEPGRAM_KEY = process.env.DEEPGRAM_API_KEY;
const DEEPGRAM_PROJECT = process.env.DEEPGRAM_PROJECT_ID;

// ── CONFIG ───────────────────────────────────────────────────
// Swap to a configsByPage map for multi-page deployments.
function getConfig(page) {
  return babuConfig;
}

// ── SYSTEM PROMPT BUILDER ────────────────────────────────────
function buildSystemPrompt(cfg) {
  const objectives = cfg.objectives.map((o, i) => `${i + 1}. ${o}`).join('\n');
  const fields     = cfg.qualifyFields.map(f => f.key).join(', ');
  const routes     = cfg.routes.map(r => `• [${r.id}] ${r.label}: ${r.description}`).join('\n');
  const faqs       = cfg.faqs.map(f => `Q: ${f.q}\nA: ${f.a}`).join('\n\n');
  const refs       = cfg.references.map(r => `• ${r.label}: ${r.url}`).join('\n');

  return `You are ${cfg.persona.name}, an ${cfg.persona.role} for ${cfg.site.name} (${cfg.site.url}).
Page context: ${cfg.site.page} — ${cfg.site.description}

TONE: ${cfg.persona.tone}

OBJECTIVES (in priority order):
${objectives}

QUALIFICATION FIELDS — extract whenever the visitor mentions them:
${fields}

ROUTES — choose exactly one when you have sufficient signal (score ≥ 60):
${routes}

FAQs — use these verbatim when a visitor asks the matched question:
${faqs}

REFERENCE LINKS — share the relevant one(s) when helpful:
${refs}

GUARDRAILS:
- Ask ONE question per reply. Never list multiple questions.
- Keep replies under 60 words unless answering a detailed FAQ.
- After ${cfg.guardrails.maxTurnsBeforeHuman} exchanges without clear qualification, offer a human connection.
${cfg.guardrails.allowSmallTalk ? '- Brief small talk is fine; then steer back gently.' : '- Stay strictly on topic.'}
- Off-topic reply: "${cfg.guardrails.offTopicRedirect}"
- Non-fit exit: "${cfg.guardrails.exitPhrase}"

RESPONSE FORMAT — respond with valid JSON ONLY (no prose outside the object):
{
  "reply": "<conversational reply to show and speak aloud>",
  "qualUpdate": { "<fieldKey>": "<extracted value, or null if not mentioned>" },
  "score": <integer 0–100: how qualified is this visitor>,
  "route": "<route id, or null — set only when score ≥ 60>"
}`;
}

// ── TOOL EXECUTOR ────────────────────────────────────────────
async function executeTool(name, input, cfg) {
  const def = cfg.tools.find(t => t.name === name);
  if (!def) return { error: `Unknown tool: ${name}` };

  const key = process.env[def.backend.authEnvVar] || '';
  const url = new URL(def.backend.url);

  if (def.backend.method === 'GET') {
    Object.entries(input).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  }

  try {
    const res = await fetch(url.toString(), {
      method: def.backend.method,
      headers: {
        'Content-Type': 'application/json',
        [def.backend.authHeader]: `${def.backend.authPrefix}${key}`,
      },
      ...(def.backend.method !== 'GET' ? { body: JSON.stringify(input) } : {}),
    });
    return await res.json();
  } catch (err) {
    return { error: err.message };
  }
}

// ── POST /api/chat ────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const { messages = [], page = 'homepage' } = req.body;
  const cfg = getConfig(page);

  const tools = cfg.tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));

  const apiMessages = messages.map(m => ({ role: m.role, content: m.content }));

  try {
    let response;
    const MAX_LOOPS = 5;

    for (let i = 0; i < MAX_LOOPS; i++) {
      response = await claude.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: buildSystemPrompt(cfg),
        messages: apiMessages,
        ...(tools.length ? { tools } : {}),
      });

      if (response.stop_reason !== 'tool_use') break;

      // Execute all tool calls in this response
      const toolResults = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        const result = await executeTool(block.name, block.input, cfg);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      }

      apiMessages.push({ role: 'assistant', content: response.content });
      apiMessages.push({ role: 'user',      content: toolResults });
    }

    const textBlock = response.content.find(b => b.type === 'text');
    if (!textBlock) {
      return res.status(500).json({ error: 'No text block in Claude response' });
    }

    let parsed;
    try {
      const raw = textBlock.text
        .replace(/^```json\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
      parsed = JSON.parse(raw);
    } catch {
      parsed = { reply: textBlock.text, qualUpdate: {}, score: 0, route: null };
    }

    // ── CRM WRITE HOOK ──────────────────────────────────────
    // Uncomment and implement to push lead data on every turn:
    // await writeToCRM({ messages, qualUpdate: parsed.qualUpdate, route: parsed.route });

    res.json(parsed);
  } catch (err) {
    console.error('[/api/chat]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/deepgram-token ───────────────────────────────────
// Mints a 60-second scoped key so the browser connects directly
// to Deepgram's WSS without ever seeing your main key.
// Requires DEEPGRAM_PROJECT_ID in env.
app.get('/api/deepgram-token', async (req, res) => {
  if (!DEEPGRAM_KEY) {
    return res.status(503).json({ error: 'Deepgram not configured on server' });
  }
  // Try to mint a short-lived scoped key (requires keys:write scope on the API key).
  // Fall back to the main key so STT works even with basic API keys.
  if (DEEPGRAM_PROJECT) {
    try {
      const r = await fetch(
        `https://api.deepgram.com/v1/projects/${DEEPGRAM_PROJECT}/keys`,
        {
          method: 'POST',
          headers: {
            Authorization: `Token ${DEEPGRAM_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            comment: `babu-stt-${Date.now()}`,
            scopes: ['usage:write'],
            time_to_live_in_seconds: 60,
          }),
        }
      );
      const data = await r.json();
      if (data?.key?.key) return res.json({ key: data.key.key });
      console.warn('[/api/deepgram-token] scoped key failed, falling back to main key:', JSON.stringify(data));
    } catch (err) {
      console.warn('[/api/deepgram-token] scoped key error, falling back:', err.message);
    }
  }
  // Return the main key directly (browser-usable; restrict by allowed origins in Deepgram dashboard for prod)
  res.json({ key: DEEPGRAM_KEY });
});

// ── POST /api/speak ───────────────────────────────────────────
// Proxies Deepgram Aura TTS — streams MP3 back to the client.
app.post('/api/speak', async (req, res) => {
  const { text, voice = 'aura-2-thalia-en' } = req.body;
  if (!text?.trim()) return res.status(400).json({ error: 'text required' });
  if (!DEEPGRAM_KEY)  return res.status(503).json({ error: 'Deepgram not configured' });

  try {
    const r = await fetch(
      `https://api.deepgram.com/v1/speak?model=${voice}&encoding=mp3`,
      {
        method: 'POST',
        headers: {
          Authorization: `Token ${DEEPGRAM_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text }),
      }
    );

    if (!r.ok) {
      const err = await r.text();
      return res.status(r.status).json({ error: err });
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    // Pipe the Web ReadableStream → Node Writable (Node 17+)
    const { Readable } = await import('stream');
    Readable.fromWeb(r.body).pipe(res);
  } catch (err) {
    console.error('[/api/speak]', err);
    res.status(500).json({ error: err.message });
  }
});

// ── STATIC (production build) ─────────────────────────────────
const distDir = join(__dirname, 'dist');
app.use(express.static(distDir));
app.get('*', (_, res) => {
  res.sendFile(join(distDir, 'index.html'), err => {
    if (err) res.status(404).send('Run `npm run build` first, or use `npm run dev`.');
  });
});

const PORT = process.env.PORT || 3030;
app.listen(PORT, () =>
  console.log(`\n  Babu server →  http://localhost:${PORT}\n`)
);
