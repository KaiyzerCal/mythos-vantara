// OpenClaude provider catalog — ported from KaiyzerCal/openclaude
// Transport kinds: anthropic-native | openai-compatible | gemini-native | local

export type TransportKind =
  | "anthropic-native"
  | "openai-compatible"
  | "gemini-native"
  | "local";

export type AuthMode = "api-key" | "oauth" | "none";

export interface ProviderModel {
  id: string;
  label: string;
  contextK: number;           // context window in K tokens
  vision?: boolean;
  reasoning?: boolean;
  fast?: boolean;             // low-latency / cheap tier
}

export interface ProviderDef {
  id: string;
  label: string;
  description: string;
  logo: string;               // emoji logo
  color: string;              // tailwind text color
  bgColor: string;
  borderColor: string;
  transport: TransportKind;
  authMode: AuthMode;
  envKey: string;             // env var name for API key
  baseUrl: string;            // base URL for API calls
  docsUrl: string;
  models: ProviderModel[];
  vision: boolean;
  streaming: boolean;
  functionCalling: boolean;
  reasoning: boolean;
  local?: boolean;
}

export const PROVIDERS: ProviderDef[] = [
  // ── Anthropic ─────────────────────────────────────────────
  {
    id: "anthropic",
    label: "Anthropic Claude",
    description: "The model powering MAVIS. Most capable for reasoning, coding, and long-context tasks.",
    logo: "🧠",
    color: "text-violet-400",
    bgColor: "bg-violet-500/10",
    borderColor: "border-violet-500/30",
    transport: "anthropic-native",
    authMode: "api-key",
    envKey: "ANTHROPIC_API_KEY",
    baseUrl: "https://api.anthropic.com",
    docsUrl: "https://docs.anthropic.com",
    vision: true,
    streaming: true,
    functionCalling: true,
    reasoning: true,
    models: [
      { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", contextK: 200, vision: true },
      { id: "claude-opus-4-8",   label: "Claude Opus 4.8",   contextK: 200, vision: true, reasoning: true },
      { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", contextK: 200, vision: true, fast: true },
      { id: "claude-sonnet-5",   label: "Claude Sonnet 5",   contextK: 200, vision: true, reasoning: true },
    ],
  },

  // ── OpenAI GPT ────────────────────────────────────────────
  {
    id: "openai",
    label: "OpenAI GPT",
    description: "GPT-4.1, GPT-4o, o3, o4-mini. Strong at code, reasoning chains, and multimodal tasks.",
    logo: "🤖",
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10",
    borderColor: "border-emerald-500/30",
    transport: "openai-compatible",
    authMode: "api-key",
    envKey: "OPENAI_API_KEY",
    baseUrl: "https://api.openai.com/v1",
    docsUrl: "https://platform.openai.com/docs",
    vision: true,
    streaming: true,
    functionCalling: true,
    reasoning: true,
    models: [
      { id: "gpt-4.1",       label: "GPT-4.1",       contextK: 1000, vision: true },
      { id: "gpt-4.1-mini",  label: "GPT-4.1 Mini",  contextK: 1000, vision: true, fast: true },
      { id: "gpt-4o",        label: "GPT-4o",         contextK: 128,  vision: true },
      { id: "gpt-4o-mini",   label: "GPT-4o Mini",    contextK: 128,  vision: true, fast: true },
      { id: "o4-mini",       label: "o4-mini",        contextK: 200,  reasoning: true, fast: true },
      { id: "o3",            label: "o3",             contextK: 200,  reasoning: true },
      { id: "o3-mini",       label: "o3-mini",        contextK: 200,  reasoning: true, fast: true },
    ],
  },

  // ── Google Gemini ─────────────────────────────────────────
  {
    id: "gemini",
    label: "Google Gemini",
    description: "Gemini 2.5 Pro with 1M context. Exceptional at long documents and multimodal reasoning.",
    logo: "✨",
    color: "text-blue-400",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/30",
    transport: "gemini-native",
    authMode: "api-key",
    envKey: "GEMINI_API_KEY",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    docsUrl: "https://ai.google.dev/docs",
    vision: true,
    streaming: true,
    functionCalling: true,
    reasoning: true,
    models: [
      { id: "gemini-2.5-pro",        label: "Gemini 2.5 Pro",       contextK: 1048, vision: true, reasoning: true },
      { id: "gemini-2.5-flash",      label: "Gemini 2.5 Flash",     contextK: 1048, vision: true, fast: true },
      { id: "gemini-2.0-flash",      label: "Gemini 2.0 Flash",     contextK: 1048, vision: true, fast: true },
      { id: "gemini-2.0-flash-thinking", label: "Gemini 2.0 Flash Thinking", contextK: 32, reasoning: true },
    ],
  },

  // ── DeepSeek ──────────────────────────────────────────────
  {
    id: "deepseek",
    label: "DeepSeek",
    description: "Leading open-weight reasoning model. DeepSeek-R1 rivals frontier models at a fraction of the cost.",
    logo: "🌊",
    color: "text-cyan-400",
    bgColor: "bg-cyan-500/10",
    borderColor: "border-cyan-500/30",
    transport: "openai-compatible",
    authMode: "api-key",
    envKey: "DEEPSEEK_API_KEY",
    baseUrl: "https://api.deepseek.com/v1",
    docsUrl: "https://api-docs.deepseek.com",
    vision: false,
    streaming: true,
    functionCalling: true,
    reasoning: true,
    models: [
      { id: "deepseek-reasoner",  label: "DeepSeek Reasoner (R1)", contextK: 64, reasoning: true },
      { id: "deepseek-chat",      label: "DeepSeek Chat (V3)",     contextK: 64 },
      { id: "deepseek-v4-pro",    label: "DeepSeek V4 Pro",        contextK: 128 },
      { id: "deepseek-v4-flash",  label: "DeepSeek V4 Flash",      contextK: 128, fast: true },
    ],
  },

  // ── Groq ──────────────────────────────────────────────────
  {
    id: "groq",
    label: "Groq",
    description: "Ultra-fast inference on LPU hardware. Sub-200ms responses for Llama 3.1 and Mixtral.",
    logo: "⚡",
    color: "text-orange-400",
    bgColor: "bg-orange-500/10",
    borderColor: "border-orange-500/30",
    transport: "openai-compatible",
    authMode: "api-key",
    envKey: "GROQ_API_KEY",
    baseUrl: "https://api.groq.com/openai/v1",
    docsUrl: "https://console.groq.com/docs",
    vision: true,
    streaming: true,
    functionCalling: true,
    reasoning: false,
    models: [
      { id: "llama-3.1-70b-versatile",   label: "Llama 3.1 70B",      contextK: 128, fast: true },
      { id: "llama-3.1-8b-instant",       label: "Llama 3.1 8B",       contextK: 128, fast: true },
      { id: "llama3-groq-70b-8192-tool-use-preview", label: "Llama3 70B Tool", contextK: 8, fast: true },
      { id: "mixtral-8x7b-32768",         label: "Mixtral 8x7B",       contextK: 32, fast: true },
      { id: "gemma2-9b-it",               label: "Gemma2 9B",          contextK: 8, fast: true },
    ],
  },

  // ── Mistral ───────────────────────────────────────────────
  {
    id: "mistral",
    label: "Mistral AI",
    description: "European frontier AI — Mistral Large 2, Codestral for code, and Mixtral MoE models.",
    logo: "🌀",
    color: "text-indigo-400",
    bgColor: "bg-indigo-500/10",
    borderColor: "border-indigo-500/30",
    transport: "openai-compatible",
    authMode: "api-key",
    envKey: "MISTRAL_API_KEY",
    baseUrl: "https://api.mistral.ai/v1",
    docsUrl: "https://docs.mistral.ai",
    vision: true,
    streaming: true,
    functionCalling: true,
    reasoning: false,
    models: [
      { id: "mistral-large-latest",   label: "Mistral Large 2",  contextK: 128 },
      { id: "mistral-medium-latest",  label: "Mistral Medium",   contextK: 128 },
      { id: "mistral-small-latest",   label: "Mistral Small",    contextK: 128, fast: true },
      { id: "codestral-latest",       label: "Codestral",        contextK: 256 },
      { id: "pixtral-large-latest",   label: "Pixtral Large",    contextK: 128, vision: true },
    ],
  },

  // ── xAI Grok ──────────────────────────────────────────────
  {
    id: "xai",
    label: "xAI Grok",
    description: "Real-time web access, long context, and strong reasoning from Elon Musk's xAI.",
    logo: "𝕏",
    color: "text-zinc-300",
    bgColor: "bg-zinc-500/10",
    borderColor: "border-zinc-500/30",
    transport: "openai-compatible",
    authMode: "api-key",
    envKey: "XAI_API_KEY",
    baseUrl: "https://api.x.ai/v1",
    docsUrl: "https://docs.x.ai",
    vision: true,
    streaming: true,
    functionCalling: true,
    reasoning: true,
    models: [
      { id: "grok-3",           label: "Grok 3",        contextK: 131, vision: true, reasoning: true },
      { id: "grok-3-mini",      label: "Grok 3 Mini",   contextK: 131, fast: true },
      { id: "grok-2-vision",    label: "Grok 2 Vision", contextK: 32,  vision: true },
    ],
  },

  // ── Fireworks ─────────────────────────────────────────────
  {
    id: "fireworks",
    label: "Fireworks AI",
    description: "Fast open-source inference. Access Llama, Mixtral, Qwen, and 50+ models in one API.",
    logo: "🎆",
    color: "text-red-400",
    bgColor: "bg-red-500/10",
    borderColor: "border-red-500/30",
    transport: "openai-compatible",
    authMode: "api-key",
    envKey: "FIREWORKS_API_KEY",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    docsUrl: "https://docs.fireworks.ai",
    vision: false,
    streaming: true,
    functionCalling: true,
    reasoning: false,
    models: [
      { id: "accounts/fireworks/models/llama-v3p1-70b-instruct", label: "Llama 3.1 70B", contextK: 131, fast: true },
      { id: "accounts/fireworks/models/llama-v3p1-405b-instruct", label: "Llama 3.1 405B", contextK: 131 },
      { id: "accounts/fireworks/models/mixtral-8x22b-instruct",   label: "Mixtral 8x22B", contextK: 64 },
      { id: "accounts/fireworks/models/qwen2p5-72b-instruct",     label: "Qwen 2.5 72B",  contextK: 128 },
    ],
  },

  // ── OpenRouter ────────────────────────────────────────────
  {
    id: "openrouter",
    label: "OpenRouter",
    description: "Single API for 200+ models. Mix and match Claude, GPT, Gemini, Llama, and more.",
    logo: "🔀",
    color: "text-purple-400",
    bgColor: "bg-purple-500/10",
    borderColor: "border-purple-500/30",
    transport: "openai-compatible",
    authMode: "api-key",
    envKey: "OPENROUTER_API_KEY",
    baseUrl: "https://openrouter.ai/api/v1",
    docsUrl: "https://openrouter.ai/docs",
    vision: true,
    streaming: true,
    functionCalling: true,
    reasoning: true,
    models: [
      { id: "anthropic/claude-sonnet-4-5",       label: "Claude Sonnet 4.5 (via OR)",  contextK: 200, vision: true },
      { id: "openai/gpt-4o",                     label: "GPT-4o (via OR)",             contextK: 128, vision: true },
      { id: "google/gemini-2.5-pro",             label: "Gemini 2.5 Pro (via OR)",     contextK: 1048, vision: true },
      { id: "meta-llama/llama-3.1-70b-instruct", label: "Llama 3.1 70B (via OR)",     contextK: 128, fast: true },
      { id: "deepseek/deepseek-r1",              label: "DeepSeek R1 (via OR)",        contextK: 64, reasoning: true },
      { id: "mistralai/mistral-large",           label: "Mistral Large (via OR)",      contextK: 128 },
    ],
  },

  // ── Ollama (local) ────────────────────────────────────────
  {
    id: "ollama",
    label: "Ollama (Local)",
    description: "Run open-source models locally. Privacy-first — nothing leaves your machine.",
    logo: "🦙",
    color: "text-amber-400",
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-500/30",
    transport: "local",
    authMode: "none",
    envKey: "",
    baseUrl: "http://localhost:11434/v1",
    docsUrl: "https://ollama.com",
    vision: false,
    streaming: true,
    functionCalling: false,
    reasoning: false,
    local: true,
    models: [
      { id: "llama3.1:8b",    label: "Llama 3.1 8B",   contextK: 128, fast: true },
      { id: "llama3.1:70b",   label: "Llama 3.1 70B",  contextK: 128 },
      { id: "mistral:7b",     label: "Mistral 7B",     contextK: 32, fast: true },
      { id: "phi3:mini",      label: "Phi-3 Mini",     contextK: 128, fast: true },
      { id: "qwen2.5:14b",    label: "Qwen 2.5 14B",   contextK: 128 },
      { id: "codellama:13b",  label: "CodeLlama 13B",  contextK: 16 },
      { id: "gemma2:9b",      label: "Gemma2 9B",      contextK: 8, fast: true },
    ],
  },
];

export function getProvider(id: string): ProviderDef | undefined {
  return PROVIDERS.find(p => p.id === id);
}

export const CAPABILITY_BADGES = [
  { key: "vision",          label: "Vision",    color: "text-blue-400   bg-blue-500/10   border-blue-500/30"   },
  { key: "reasoning",       label: "Reasoning", color: "text-purple-400 bg-purple-500/10 border-purple-500/30" },
  { key: "functionCalling", label: "Tools",     color: "text-green-400  bg-green-500/10  border-green-500/30"  },
  { key: "streaming",       label: "Stream",    color: "text-cyan-400   bg-cyan-500/10   border-cyan-500/30"   },
  { key: "local",           label: "Local",     color: "text-amber-400  bg-amber-500/10  border-amber-500/30"  },
];
