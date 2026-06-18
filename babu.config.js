// ============================================================
//  babu.config.js — Single source of truth for your Babu setup.
//  Edit this file to customise Babu for each page / deployment.
//  For multiple pages: export a configsByPage map and update
//  getConfig() in server.js to select by page key.
// ============================================================

export const babuConfig = {

  // ── SITE ─────────────────────────────────────────────────
  site: {
    name: "Kampaign.ai",
    url: "https://kampaign.ai",
    page: "homepage",   // unique key — use per-page to have different personas
    description:
      "Kampaign.ai is an AI-powered campaign-generation and management platform " +
      "that helps B2B sales and marketing teams create personalised outbound sequences at scale.",
  },

  // ── PERSONA ──────────────────────────────────────────────
  persona: {
    name: "Babu",
    role: "AI Sales Development Representative",
    tone: "warm, concise, curious — one question at a time, never pushy",
    greeting:
      "Hi 👋  I'm Babu, Kampaign.ai's AI guide. I help visitors figure out if we're a fit " +
      "and get them to the fastest next step — takes about 2 minutes. What brings you here today?",
    avatarEmoji: "🤖",
  },

  // ── QUALIFICATION OBJECTIVES ─────────────────────────────
  objectives: [
    "Understand the visitor's role and company context (industry, size).",
    "Identify their core pain around outbound / campaign creation / personalisation.",
    "Gauge urgency and decision timeline.",
    "Qualify against ICP: B2B company, 10+ person sales or marketing team, running or planning outbound.",
    "Route qualified prospects to a demo; high-urgency fits to a live rep; researchers to resources; non-fits off gracefully.",
  ],

  // ── QUALIFY FIELDS ───────────────────────────────────────
  // Shown in the side panel; extracted from conversation by Claude.
  qualifyFields: [
    { key: "role",       label: "Role",        icon: "👤" },
    { key: "company",    label: "Company",     icon: "🏢" },
    { key: "teamSize",   label: "Team size",   icon: "👥" },
    { key: "useCase",    label: "Use case",    icon: "🎯" },
    { key: "painPoint",  label: "Pain point",  icon: "😤" },
    { key: "timeline",   label: "Timeline",    icon: "📅" },
    { key: "budget",     label: "Budget signal", icon: "💰" },
  ],

  // ── ROUTES ───────────────────────────────────────────────
  routes: [
    {
      id: "book_demo",
      label: "Book a Demo",
      description: "Qualified ICP fit who wants to see the product.",
      action: "url",
      value: "https://calendly.com/your-link/30min",   // ← your booking link
      cta: "Book a 30-min demo →",
      icon: "📅",
    },
    {
      id: "start_trial",
      label: "Start Free Trial",
      description: "Self-serve fit who wants to try it themselves.",
      action: "url",
      value: "https://app.kampaign.ai/signup",
      cta: "Start your free trial →",
      icon: "🚀",
    },
    {
      id: "talk_human",
      label: "Talk to Sales",
      description: "High urgency or complex deal that needs a human now.",
      action: "url",
      value: "https://kampaign.ai/contact-sales",
      cta: "Chat with our team →",
      icon: "💬",
    },
    {
      id: "send_resources",
      label: "Send Resources",
      description: "Researching, not ready to buy yet.",
      action: "resources",
      cta: "Get our free guide →",
      icon: "📚",
    },
    {
      id: "not_a_fit",
      label: "Not a Fit",
      description: "Outside ICP — wrong role, B2C, solo operator.",
      action: "close",
      cta: "Thanks for stopping by!",
      icon: "👋",
    },
  ],

  // ── FAQs ─────────────────────────────────────────────────
  faqs: [
    {
      q: "How much does Kampaign.ai cost?",
      a: "Pricing starts at $99/month for teams up to 5. Enterprise plans available. Book a demo for a custom quote.",
    },
    {
      q: "Does it integrate with my CRM?",
      a: "Yes — HubSpot, Salesforce, Pipedrive, and more out of the box.",
    },
    {
      q: "How long does setup take?",
      a: "Most customers run their first campaign in under an hour.",
    },
    {
      q: "Is there a free trial?",
      a: "Yes, 14-day free trial, no credit card required.",
    },
    {
      q: "Can I import my existing sequences?",
      a: "Yes — we have importers for most major sequencing tools.",
    },
    {
      q: "Is it GDPR / SOC 2 compliant?",
      a: "Kampaign.ai is SOC 2 Type II certified and fully GDPR compliant.",
    },
  ],

  // ── REFERENCE LINKS ──────────────────────────────────────
  references: [
    { label: "Pricing",           url: "https://kampaign.ai/pricing" },
    { label: "Customer stories",  url: "https://kampaign.ai/customers" },
    { label: "Product overview",  url: "https://kampaign.ai/product" },
    { label: "Integrations",      url: "https://kampaign.ai/integrations" },
    { label: "Security & privacy",url: "https://kampaign.ai/security" },
    { label: "Blog",              url: "https://kampaign.ai/blog" },
  ],

  // ── TOOLS / APIs Babu can call ───────────────────────────
  // Schemas are sent to Claude; the backend executes calls
  // using the server-side env var — keys never reach the client.
  tools: [
    {
      name: "lookup_company",
      description:
        "Look up firmographic data for a company by name or domain. " +
        "Returns headcount, industry, funding stage, and tech stack when available.",
      parameters: {
        type: "object",
        properties: {
          company_name: {
            type: "string",
            description: "Company name or domain, e.g. 'Acme Corp' or 'acme.com'",
          },
        },
        required: ["company_name"],
      },
      backend: {
        method: "GET",
        url: "https://api.yourcrm.com/enrich/company",
        authEnvVar: "ENRICH_API_KEY",   // name of env var holding the key
        authHeader: "Authorization",
        authPrefix: "Bearer ",
      },
    },
    {
      name: "check_availability",
      description:
        "Check available demo slots in the next 7 days. Returns 3 time options.",
      parameters: {
        type: "object",
        properties: {
          timezone: {
            type: "string",
            description: "Visitor's timezone, e.g. 'America/New_York'",
          },
        },
        required: [],
      },
      backend: {
        method: "GET",
        url: "https://api.calendly.com/event_types/your-event-id/available_times",
        authEnvVar: "CALENDLY_API_KEY",
        authHeader: "Authorization",
        authPrefix: "Bearer ",
      },
    },
  ],

  // ── GUARDRAILS ───────────────────────────────────────────
  guardrails: {
    maxTurnsBeforeHuman: 10,
    allowSmallTalk: true,
    offTopicRedirect:
      "Happy to chat, but I'm best at helping you figure out if Kampaign.ai is right for you. Want to continue?",
    exitPhrase:
      "Thanks for stopping by! Come back any time — we'd love to help when the timing is right. 👋",
  },
};
