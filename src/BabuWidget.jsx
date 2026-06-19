/**
 * BabuWidget.jsx
 *
 * Config-driven AI SDR avatar. Reads all settings from babu.config.js.
 * Features:
 *  - Full-duplex voice: Deepgram STT (WebSocket) + Deepgram TTS proxy
 *  - Barge-in detection via AudioContext analyser
 *  - Falls back to Web Speech API for STT if Deepgram is unavailable
 *  - Progressive qualification panel (score, fields, route)
 *  - Tool-calling happens server-side; client just sends/receives JSON
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { babuConfig } from '../babu.config.js';

// In dev, Vite proxies /api → http://localhost:3030.
// In production set VITE_BACKEND_URL to your deployed server.
const BACKEND = import.meta.env.VITE_BACKEND_URL || '';

const cfg = babuConfig;

// ── DESIGN TOKENS ────────────────────────────────────────────
const C = {
  brand:      '#1E3A2B',
  brand2:     '#2C5240',
  accent:     '#E8943A',
  bg:         '#F7F4EC',
  surface:    '#FBF9F3',
  ink:        '#1F2421',
  inkSoft:    '#4A514B',
  inkFaint:   '#8A8F88',
  line:       '#E4DECE',
  lineSoft:   '#EDE8DA',
  hotBg:      '#FBE6E0',
  hotFg:      '#A23B22',
  coolBg:     '#E6EBE7',
  coolFg:     '#3C5A4C',
  warmBg:     '#F6EBD4',
  warmFg:     '#9A6B1E',
};

// ── SCORE METER ───────────────────────────────────────────────
function ScoreMeter({ score }) {
  const color = score >= 70 ? '#22c55e' : score >= 40 ? '#f59e0b' : C.inkFaint;
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', color: C.inkFaint, textTransform: 'uppercase' }}>
          Intent Score
        </span>
        <span style={{ fontSize: 20, fontWeight: 800, color, lineHeight: 1 }}>{score}</span>
      </div>
      <div style={{ height: 5, background: C.line, borderRadius: 99, overflow: 'hidden' }}>
        <div style={{
          height: '100%', width: `${score}%`,
          background: color, borderRadius: 99,
          transition: 'width .6s ease, background .4s ease',
        }} />
      </div>
    </div>
  );
}

// ── QUALIFICATION SIDE PANEL ──────────────────────────────────
function QualPanel({ qualData, score, route }) {
  const activeRoute = cfg.routes.find(r => r.id === route);
  return (
    <div style={{
      width: 210, padding: '18px 14px',
      background: C.bg, borderLeft: `1px solid ${C.line}`,
      overflowY: 'auto', flexShrink: 0,
      display: 'flex', flexDirection: 'column', gap: 0,
    }}>
      <ScoreMeter score={score} />

      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', color: C.inkFaint, textTransform: 'uppercase', marginBottom: 10 }}>
          Profile
        </div>
        {cfg.qualifyFields.map(f => (
          <div key={f.key} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: C.inkFaint }}>{f.icon}&nbsp;{f.label}</div>
            <div style={{
              fontSize: 13, fontWeight: 600, marginTop: 2,
              color: qualData[f.key] ? C.ink : C.line,
            }}>
              {qualData[f.key] || '—'}
            </div>
          </div>
        ))}
      </div>

      {activeRoute && (
        <div style={{
          background: C.coolBg, border: `1px solid ${C.coolFg}44`,
          borderRadius: 10, padding: '10px 12px', marginBottom: 16,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.coolFg, marginBottom: 4 }}>Route</div>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>
            {activeRoute.icon}&nbsp;{activeRoute.label}
          </div>
        </div>
      )}

      {cfg.references.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.1em', color: C.inkFaint, textTransform: 'uppercase', marginBottom: 8 }}>
            Reference links
          </div>
          {cfg.references.map(r => (
            <a key={r.url} href={r.url} target="_blank" rel="noreferrer" style={{
              display: 'block', fontSize: 12, color: C.brand,
              textDecoration: 'none', marginBottom: 5,
            }}>
              {r.label}&nbsp;→
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

// ── MESSAGE BUBBLE ────────────────────────────────────────────
function Bubble({ msg }) {
  const isBot = msg.role === 'assistant';
  return (
    <div style={{ display: 'flex', justifyContent: isBot ? 'flex-start' : 'flex-end', marginBottom: 10, gap: 8 }}>
      {isBot && (
        <div style={{
          width: 28, height: 28, borderRadius: '50%',
          background: C.brand, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, marginTop: 2,
        }}>
          {cfg.persona.avatarEmoji}
        </div>
      )}
      <div style={{
        maxWidth: '72%', padding: '10px 14px',
        background: isBot ? C.surface : C.brand,
        color: isBot ? C.ink : '#fff',
        borderRadius: isBot ? '16px 16px 16px 4px' : '16px 16px 4px 16px',
        fontSize: 14, lineHeight: 1.55,
        boxShadow: '0 1px 4px rgba(0,0,0,.06)',
      }}>
        {msg.content}
      </div>
    </div>
  );
}

// ── ROUTE CTA CARD ────────────────────────────────────────────
function RouteCard({ routeId }) {
  const r = cfg.routes.find(x => x.id === routeId);
  if (!r || r.action === 'close') return null;

  return (
    <div style={{
      margin: '6px 0 2px', padding: '12px 14px',
      background: `${C.brand}0D`, border: `1.5px solid ${C.brand}33`,
      borderRadius: 12,
    }}>
      <div style={{ fontSize: 12, color: C.inkSoft, marginBottom: 8 }}>
        {r.icon}&nbsp; Recommended next step
      </div>
      <button
        onClick={() => r.action === 'url' && window.open(r.value, '_blank')}
        style={{
          width: '100%', padding: '10px 0',
          background: C.brand, color: '#fff', border: 'none',
          borderRadius: 8, fontSize: 14, fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        {r.cta}
      </button>
    </div>
  );
}

// ── TYPING INDICATOR ──────────────────────────────────────────
function TypingDots() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
      <div style={{
        width: 28, height: 28, borderRadius: '50%',
        background: C.brand,
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13,
      }}>
        {cfg.persona.avatarEmoji}
      </div>
      <div style={{
        background: C.surface, borderRadius: '16px 16px 16px 4px',
        padding: '12px 16px', display: 'flex', gap: 4,
        boxShadow: '0 1px 4px rgba(0,0,0,.06)',
      }}>
        {[0, 1, 2].map(i => (
          <span key={i} style={{
            width: 6, height: 6, borderRadius: '50%',
            background: C.inkFaint, display: 'inline-block',
            animation: `baboDot 1.2s ${i * 0.15}s ease-in-out infinite`,
          }} />
        ))}
      </div>
    </div>
  );
}

// ── VOICE HOOK ────────────────────────────────────────────────
function useVoice({ onInterim, onFinal, enabled }) {
  const [listening, setListening]  = useState(false);
  const [speaking,  setSpeaking]   = useState(false);

  // Stable refs so WS/rAF closures always call the latest callbacks
  const onInterimRef = useRef(onInterim);
  const onFinalRef   = useRef(onFinal);
  useEffect(() => { onInterimRef.current = onInterim; }, [onInterim]);
  useEffect(() => { onFinalRef.current   = onFinal;   }, [onFinal]);

  const wsRef          = useRef(null);
  const streamRef      = useRef(null);
  const audioCtxRef    = useRef(null);
  const processorRef   = useRef(null);
  const analyserRef    = useRef(null);
  const speakingRef    = useRef(false);
  const currentAudio   = useRef(null);
  const bargeInRaf     = useRef(null);
  const speechRec      = useRef(null);  // Web Speech API fallback

  // ── Stop any ongoing speech ─────────────────────────────
  const stopSpeaking = useCallback(() => {
    cancelAnimationFrame(bargeInRaf.current);
    bargeInRaf.current = null;
    if (currentAudio.current) {
      currentAudio.current.pause();
      currentAudio.current.src = '';
      currentAudio.current = null;
    }
    speakingRef.current = false;
    setSpeaking(false);
  }, []);

  // ── Stop STT ────────────────────────────────────────────
  const stopListening = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    speechRec.current?.stop();
    speechRec.current = null;
    processorRef.current?.disconnect();
    processorRef.current = null;
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    setListening(false);
  }, []);

  // ── Start STT (Deepgram → Web Speech fallback) ──────────
  const startListening = useCallback(async () => {
    if (!enabled || wsRef.current || speechRec.current) return;

    // Try Deepgram first
    try {
      const tokenRes = await fetch(`${BACKEND}/api/deepgram-token`);
      if (tokenRes.ok) {
        const { key } = await tokenRes.json();
        if (key) {
          const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
          streamRef.current = mic;

          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          audioCtxRef.current = ctx;
          if (ctx.state === 'suspended') await ctx.resume();

          const src = ctx.createMediaStreamSource(mic);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 256;
          src.connect(analyser);
          analyserRef.current = analyser;

          // Silent sink — keeps processor alive without echoing mic to speakers
          const processor = ctx.createScriptProcessor(4096, 1, 1);
          const silent = ctx.createGain();
          silent.gain.value = 0;
          src.connect(processor);
          processor.connect(silent);
          silent.connect(ctx.destination);
          processorRef.current = processor;

          const ws = new WebSocket(
            `wss://api.deepgram.com/v1/listen` +
            `?model=nova-3&language=en-US&encoding=linear16` +
            `&sample_rate=${ctx.sampleRate}&channels=1` +
            `&smart_format=true&punctuate=true&endpointing=300&interim_results=true`,
            ['token', key]
          );
          wsRef.current = ws;

          processor.onaudioprocess = (e) => {
            if (ws.readyState !== WebSocket.OPEN) return;
            const f32 = e.inputBuffer.getChannelData(0);
            const i16 = new Int16Array(f32.length);
            for (let i = 0; i < f32.length; i++) {
              i16[i] = Math.max(-32768, Math.min(32767, f32[i] * 32768));
            }
            ws.send(i16.buffer);
          };

          ws.onopen  = () => setListening(true);
          ws.onmessage = (e) => {
            const d = JSON.parse(e.data);
            const t = d?.channel?.alternatives?.[0]?.transcript || '';
            if (!t) return;
            d.is_final ? onFinalRef.current(t) : onInterimRef.current(t);
          };
          ws.onerror = (err) => {
            console.warn('[STT] Deepgram WebSocket error', err);
            setListening(false);
            wsRef.current = null;
          };
          ws.onclose = () => {
            setListening(false);
            wsRef.current = null;
          };
          return; // Deepgram started successfully
        }
      }
    } catch (err) {
      console.warn('[STT] Deepgram unavailable, falling back to Web Speech:', err);
    }

    // Web Speech API fallback
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    const rec = new SR();
    rec.continuous    = true;
    rec.interimResults = true;
    rec.lang          = 'en-US';
    speechRec.current = rec;

    rec.onresult = (e) => {
      const last = e.results[e.results.length - 1];
      const t    = last[0].transcript;
      last.isFinal ? onFinalRef.current(t) : onInterimRef.current(t);
    };
    rec.onend = () => { setListening(false); speechRec.current = null; };
    rec.start();
    setListening(true);
  }, [enabled]);

  // ── TTS ─────────────────────────────────────────────────
  const speak = useCallback(async (text, onDone) => {
    if (!enabled || !text?.trim()) { onDone?.(); return; }

    stopSpeaking();
    speakingRef.current = true;
    setSpeaking(true);

    try {
      const res  = await fetch(`${BACKEND}/api/speak`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      if (!res.ok) throw new Error(`TTS ${res.status}`);

      const blob  = await res.blob();
      const url   = URL.createObjectURL(blob);
      const audio = new Audio(url);
      currentAudio.current = audio;

      audio.onended = () => {
        URL.revokeObjectURL(url);
        // Barge-in might have already called stopSpeaking — guard against double-call
        const wasActive = speakingRef.current;
        stopSpeaking();
        if (wasActive) onDone?.();
      };

      audio.onerror = () => { stopSpeaking(); onDone?.(); };
      await audio.play();

      // Barge-in: watch mic energy while Babu speaks
      if (analyserRef.current) {
        const freqData = new Uint8Array(analyserRef.current.frequencyBinCount);
        const checkBarge = () => {
          if (!speakingRef.current) return;
          analyserRef.current.getByteFrequencyData(freqData);
          const avg = freqData.reduce((s, v) => s + v, 0) / freqData.length;
          if (avg > 28) {
            stopSpeaking();
            onDone?.(); // resume listening since visitor is talking
          } else {
            bargeInRaf.current = requestAnimationFrame(checkBarge);
          }
        };
        bargeInRaf.current = requestAnimationFrame(checkBarge);
      }
    } catch (err) {
      console.warn('[TTS]', err.message || err);
      stopSpeaking();
      onDone?.();
    }
  }, [enabled, stopSpeaking]);

  // Cleanup on unmount
  useEffect(() => () => { stopListening(); stopSpeaking(); }, []);

  return { listening, speaking, startListening, stopListening, speak, stopSpeaking };
}

// ── MAIN WIDGET ───────────────────────────────────────────────
export default function BabuWidget() {
  const [open,       setOpen]       = useState(false);
  const [voiceOn,    setVoiceOn]    = useState(true);
  const [messages,   setMessages]   = useState([]);
  const [input,      setInput]      = useState('');
  const [interim,    setInterim]    = useState('');
  const [loading,    setLoading]    = useState(false);
  const [qualData,   setQualData]   = useState({});
  const [score,      setScore]      = useState(0);
  const [route,      setRoute]      = useState(null);
  const [showPanel,  setShowPanel]  = useState(true);

  const scrollRef   = useRef(null);
  const messagesRef = useRef([]);
  const initialized = useRef(false);

  // Keep ref in sync for use inside stable callbacks
  const syncMessages = useCallback((next) => {
    messagesRef.current = next;
    setMessages(next);
  }, []);

  // ── Voice callbacks (stable via refs inside hook) ───────
  const handleInterim = useCallback((t) => setInterim(t), []);
  const sendMessageRef = useRef(null);

  const handleFinal = useCallback((t) => {
    setInterim('');
    sendMessageRef.current?.(t);
  }, []);

  const { listening, speaking, startListening, stopListening, speak, stopSpeaking } = useVoice({
    onInterim: handleInterim,
    onFinal:   handleFinal,
    enabled:   voiceOn,
  });

  // ── Send a message ──────────────────────────────────────
  const sendMessage = useCallback(async (text) => {
    if (!text?.trim() || loading) return;
    stopListening();
    setInput('');
    setInterim('');
    setLoading(true);

    const userMsg = { role: 'user', content: text.trim() };
    const history = [...messagesRef.current, userMsg];
    syncMessages(history);

    try {
      const res  = await fetch(`${BACKEND}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history, page: cfg.site.page }),
      });
      const data = await res.json();

      if (data.reply) {
        const next = [...history, { role: 'assistant', content: data.reply }];
        syncMessages(next);

        if (data.qualUpdate) {
          setQualData(prev => ({
            ...prev,
            ...Object.fromEntries(
              Object.entries(data.qualUpdate).filter(([, v]) => v != null && v !== '')
            ),
          }));
        }
        if (typeof data.score === 'number') setScore(data.score);
        if (data.route) setRoute(data.route);

        if (voiceOn) {
          speak(data.reply, () => startListening());
        }
      }
    } catch (err) {
      const errMsg = { role: 'assistant', content: "I hit a hiccup — please try again!" };
      syncMessages([...history, errMsg]);
    } finally {
      setLoading(false);
    }
  }, [loading, voiceOn, speak, startListening, stopListening, syncMessages]);

  useEffect(() => { sendMessageRef.current = sendMessage; }, [sendMessage]);

  // ── Greeting on open ───────────────────────────────────
  useEffect(() => {
    if (!open || initialized.current) return;
    initialized.current = true;
    const greeting = { role: 'assistant', content: cfg.persona.greeting };
    syncMessages([greeting]);
    if (voiceOn) speak(cfg.persona.greeting, () => startListening());
  }, [open, voiceOn, speak, startListening, syncMessages]);

  // Auto-scroll to latest message
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, interim, loading]);

  const toggleVoice = () => {
    const next = !voiceOn;
    setVoiceOn(next);
    if (!next) {
      stopListening();
      stopSpeaking();
    } else if (open) {
      const lastBot = [...messagesRef.current].reverse().find(m => m.role === 'assistant');
      const toSpeak = lastBot?.content || cfg.persona.greeting;
      speak(toSpeak, () => startListening());
    }
  };

  const toggleMic = () => (listening ? stopListening() : startListening());

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  // Status line for header
  const statusLine = speaking && listening
    ? '🎤 listening + speaking…'
    : speaking   ? '🔊 speaking…'
    : listening  ? '🎤 listening…'
    : cfg.persona.role;

  // ── FLOATING BUTTON (closed state) ─────────────────────
  if (!open) {
    return (
      <>
        <style>{`
          @keyframes babuPulse {
            0%,100%{ transform:scale(1); box-shadow:0 4px 18px rgba(30,58,43,.45); }
            50%     { transform:scale(1.07); box-shadow:0 8px 28px rgba(30,58,43,.55); }
          }
        `}</style>
        <div style={{ position:'fixed', bottom:28, right:28, zIndex:9998 }}>
          <button
            onClick={() => setOpen(true)}
            title={`Chat with ${cfg.persona.name}`}
            style={{
              width:62, height:62, borderRadius:'50%',
              background:`radial-gradient(circle at 35% 30%, #7B4DFF, ${C.brand} 65%)`,
              border:'3px solid #fff',
              boxShadow:'0 4px 18px rgba(30,58,43,.45)',
              cursor:'pointer', fontSize:26,
              display:'flex', alignItems:'center', justifyContent:'center',
              animation:'babuPulse 3s ease-in-out infinite',
            }}
          >
            {cfg.persona.avatarEmoji}
          </button>
        </div>
      </>
    );
  }

  // ── OPEN PANEL ─────────────────────────────────────────
  return (
    <>
      <style>{`
        @keyframes babuSlide  { from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none} }
        @keyframes baboDot    { 0%,80%,100%{opacity:.25;transform:scale(.8)} 40%{opacity:1;transform:scale(1)} }
        ::-webkit-scrollbar   { width:4px }
        ::-webkit-scrollbar-track  { background:transparent }
        ::-webkit-scrollbar-thumb  { background:${C.line}; border-radius:99px }
      `}</style>

      {/* Dimmed backdrop */}
      <div
        onClick={() => setOpen(false)}
        style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.22)', zIndex:9997 }}
      />

      {/* Main panel */}
      <div style={{
        position:'fixed', bottom:20, right:20,
        width: showPanel ? 680 : 440,
        height:600,
        display:'flex', borderRadius:20, overflow:'hidden',
        boxShadow:'0 24px 64px rgba(0,0,0,.22)',
        zIndex:9998,
        animation:'babuSlide .22s ease',
        fontFamily:'system-ui,-apple-system,sans-serif',
        transition:'width .25s ease',
      }}>

        {/* ── LEFT: Chat ── */}
        <div style={{ flex:1, display:'flex', flexDirection:'column', background:C.bg, minWidth:0 }}>

          {/* Header */}
          <div style={{
            padding:'13px 16px',
            background:C.brand, color:'#fff',
            display:'flex', alignItems:'center', gap:10,
            flexShrink:0,
          }}>
            <div style={{
              width:36, height:36, borderRadius:'50%',
              background:'#ffffff22',
              display:'flex', alignItems:'center', justifyContent:'center', fontSize:17, flexShrink:0,
            }}>
              {cfg.persona.avatarEmoji}
            </div>

            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontWeight:700, fontSize:15 }}>{cfg.persona.name}</div>
              <div style={{ fontSize:11.5, opacity:.75, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                {statusLine}
              </div>
            </div>

            {/* Voice toggle */}
            <button
              onClick={toggleVoice}
              title={voiceOn ? 'Disable voice' : 'Enable voice'}
              style={{
                background: voiceOn ? '#ffffff33' : 'transparent',
                border:'1px solid #ffffff55',
                borderRadius:8, padding:'4px 8px',
                color:'#fff', cursor:'pointer', fontSize:15, flexShrink:0,
              }}
            >
              {voiceOn ? '🔊' : '🔇'}
            </button>

            {/* Panel toggle */}
            <button
              onClick={() => setShowPanel(s => !s)}
              title="Toggle qualification panel"
              style={{
                background:'transparent', border:'1px solid #ffffff55',
                borderRadius:8, padding:'4px 7px',
                color:'#fff', cursor:'pointer', fontSize:12, flexShrink:0,
              }}
            >
              {showPanel ? '▶' : '◀'}
            </button>

            {/* Close */}
            <button
              onClick={() => setOpen(false)}
              style={{ background:'transparent', border:'none', color:'#fff', cursor:'pointer', fontSize:22, lineHeight:1, flexShrink:0 }}
            >
              ×
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} style={{ flex:1, overflowY:'auto', padding:'16px 12px' }}>
            {messages.map((m, i) => <Bubble key={i} msg={m} />)}

            {/* Interim (live transcription) */}
            {interim && (
              <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:8 }}>
                <div style={{
                  background:C.brand, color:'#ffffffbb',
                  borderRadius:'16px 16px 4px 16px',
                  padding:'10px 14px', fontSize:14, fontStyle:'italic',
                  maxWidth:'72%',
                }}>
                  {interim}…
                </div>
              </div>
            )}

            {loading && <TypingDots />}

            {route && !loading && <RouteCard routeId={route} />}
          </div>

          {/* Input bar */}
          <div style={{
            padding:'10px 12px', borderTop:`1px solid ${C.line}`,
            display:'flex', gap:8, alignItems:'flex-end',
            background:C.surface, flexShrink:0,
          }}>
            {voiceOn && (
              <button
                onClick={toggleMic}
                title={listening ? 'Stop mic' : 'Start mic'}
                style={{
                  width:38, height:38, borderRadius:10, flexShrink:0,
                  border:`1.5px solid ${listening ? C.brand : C.line}`,
                  background: listening ? `${C.brand}18` : 'transparent',
                  color: listening ? C.brand : C.inkFaint,
                  cursor:'pointer', fontSize:16,
                  display:'flex', alignItems:'center', justifyContent:'center',
                }}
              >
                🎤
              </button>
            )}

            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder={listening ? 'Listening… or type here' : `Message ${cfg.persona.name}…`}
              disabled={loading}
              rows={1}
              style={{
                flex:1, resize:'none', border:`1px solid ${C.line}`,
                borderRadius:12, padding:'10px 12px',
                fontSize:14, fontFamily:'inherit',
                background:C.bg, color:C.ink, maxHeight:88,
                outline:'none',
              }}
            />

            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || loading}
              style={{
                width:38, height:38, borderRadius:10, flexShrink:0,
                border:'none',
                background: !input.trim() || loading ? C.line : C.brand,
                color:'#fff',
                cursor: !input.trim() || loading ? 'default' : 'pointer',
                fontSize:16,
                display:'flex', alignItems:'center', justifyContent:'center',
              }}
            >
              ↑
            </button>
          </div>
        </div>

        {/* ── RIGHT: Qualification panel ── */}
        {showPanel && <QualPanel qualData={qualData} score={score} route={route} />}
      </div>
    </>
  );
}
