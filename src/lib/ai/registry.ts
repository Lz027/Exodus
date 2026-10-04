// Client-safe provider registry. Model IDs live here so server and UI agree,
// but the UI only ever renders labels and descriptions.
export type ProfileKey = "kimi" | "general" | "fast" | "deep" | "reasoning" | "vision";
export type Capability = "chat" | "coding" | "reasoning" | "vision";
export type ProfileGroup = "Chat" | "Vision";
export type ModelState = "available" | "unavailable" | "unknown";

export type Budget = { maxInputTokens: number; maxOutputTokens: number };

export type ModelProfile = {
  key: ProfileKey;
  label: string;
  description: string;
  group: ProfileGroup;
  modelId: string;
  /** Automatic, transparent fallback. Kimi and Vision never fall back automatically. */
  fallback?: ProfileKey;
  capability: Capability;
  budget: Budget;
};

export const PROVIDER = "Groq";

export const profiles: Record<ProfileKey, ModelProfile> = {
  kimi: { key: "kimi", label: "Kimi K2", description: "Coding, architecture and multi-file reasoning", group: "Chat", modelId: "moonshotai/kimi-k2-instruct-0905", capability: "coding", budget: { maxInputTokens: 24000, maxOutputTokens: 4096 } },
  general: { key: "general", label: "General", description: "Conversation, planning and writing", group: "Chat", modelId: "llama-3.3-70b-versatile", fallback: "reasoning", capability: "chat", budget: { maxInputTokens: 16000, maxOutputTokens: 2048 } },
  fast: { key: "fast", label: "Fast", description: "Quick rewrites and short answers", group: "Chat", modelId: "llama-3.1-8b-instant", fallback: "general", capability: "chat", budget: { maxInputTokens: 8000, maxOutputTokens: 1024 } },
  deep: { key: "deep", label: "Deep Reason", description: "Difficult planning and complex design", group: "Chat", modelId: "openai/gpt-oss-120b", capability: "reasoning", budget: { maxInputTokens: 24000, maxOutputTokens: 4096 } },
  reasoning: { key: "reasoning", label: "Reasoning", description: "Efficient structured analysis", group: "Chat", modelId: "openai/gpt-oss-20b", capability: "reasoning", budget: { maxInputTokens: 16000, maxOutputTokens: 2048 } },
  vision: { key: "vision", label: "Vision", description: "Screenshots, diagrams and image questions", group: "Vision", modelId: "meta-llama/llama-4-scout-17b-16e-instruct", capability: "vision", budget: { maxInputTokens: 12000, maxOutputTokens: 2048 } },
};

export const chatProfileOrder: ProfileKey[] = ["kimi", "general", "fast", "deep", "reasoning"];

export const audio = {
  transcribe: { label: "Voice", modelId: "whisper-large-v3-turbo", highAccuracyModelId: "whisper-large-v3" },
  speak: { label: "Speak", modelId: "canopylabs/orpheus-v1-english", voice: "autumn" },
};

export const limits = {
  /** Above this estimated input size the user must confirm first. */
  largeContextTokens: 10000,
  projectContextChars: 6000,
  maxHistoryMessages: 40,
  maxImages: 4,
  maxImageBytes: 4 * 1024 * 1024,
  requestsPerMinute: 20,
  requestTimeoutMs: 90_000,
  maxRetries: 2,
};

export const defaultProfileFor = (workspace: "general" | "coding"): ProfileKey => (workspace === "coding" ? "kimi" : "general");

export type Availability = Record<ProfileKey | "voice" | "speak", ModelState>;

/** Rough token estimate (~4 chars per token). Estimates only. */
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

export const KIMI_UNAVAILABLE = "Kimi K2 is currently unavailable. You can connect Kimi directly or enable fallback to Deep Reason.";
export const KIMI_CONFIRM = "Kimi K2 is unavailable. Use Deep Reason for this coding request instead?";
export const LARGE_CONFIRM = "This request includes a large project context and may use more tokens than usual. Continue?";
