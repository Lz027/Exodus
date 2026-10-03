// Client-safe provider registry. Model IDs live here so server and UI agree,
// but the UI only ever renders labels and descriptions.
export type ProfileKey = "kimi" | "general" | "fast" | "deep" | "reasoning" | "vision";
export type Capability = "chat" | "coding" | "reasoning" | "vision";
export type ProfileGroup = "Chat" | "Vision" | "Utility";

export type ModelProfile = {
  key: ProfileKey;
  label: string;
  description: string;
  group: ProfileGroup;
  modelId: string;
  fallback?: ProfileKey;
  capability: Capability;
  preferredFor?: "general" | "coding";
  userSelectable: boolean;
};

export const PROVIDER = "Groq";

export const profiles: Record<ProfileKey, ModelProfile> = {
  kimi: { key: "kimi", label: "Kimi K2", description: "Coding, architecture and multi-file reasoning", group: "Chat", modelId: "moonshotai/kimi-k2-instruct", fallback: "deep", capability: "coding", preferredFor: "coding", userSelectable: true },
  general: { key: "general", label: "General", description: "Conversation, planning and writing", group: "Chat", modelId: "llama-3.3-70b-versatile", fallback: "reasoning", capability: "chat", preferredFor: "general", userSelectable: true },
  fast: { key: "fast", label: "Fast", description: "Quick rewrites and short answers", group: "Chat", modelId: "llama-3.1-8b-instant", fallback: "general", capability: "chat", userSelectable: true },
  deep: { key: "deep", label: "Deep Reason", description: "Difficult planning and complex design", group: "Chat", modelId: "openai/gpt-oss-120b", fallback: "reasoning", capability: "reasoning", userSelectable: true },
  reasoning: { key: "reasoning", label: "Reasoning", description: "Efficient structured analysis", group: "Chat", modelId: "openai/gpt-oss-20b", fallback: "general", capability: "reasoning", userSelectable: true },
  vision: { key: "vision", label: "Vision", description: "Screenshots, diagrams and image questions", group: "Vision", modelId: "meta-llama/llama-4-scout-17b-16e-instruct", fallback: "general", capability: "vision", userSelectable: true },
};

export const chatProfileOrder: ProfileKey[] = ["kimi", "general", "fast", "deep", "reasoning"];

export const audio = {
  transcribe: { label: "Voice", modelId: "whisper-large-v3-turbo", highAccuracyModelId: "whisper-large-v3" },
  speak: { label: "Speak", modelId: "canopylabs/orpheus-v1-english", voice: "autumn" },
};

export const defaultProfileFor = (workspace: "general" | "coding"): ProfileKey => (workspace === "coding" ? "kimi" : "general");

export type Availability = Record<ProfileKey | "voice" | "speak", boolean>;
