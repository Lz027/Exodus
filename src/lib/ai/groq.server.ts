import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { audio, limits, profiles, KIMI_CONFIRM, KIMI_UNAVAILABLE, type Availability, type ProfileKey, type ModelProfile } from "./registry";

export const GROQ_BASE = "https://api.groq.com/openai/v1";
const CACHE_MS = Number(process.env["EXODUS_MODEL_CACHE_MS"] ?? 120_000);
let cache: { at: number; ids: Set<string> } | null = null;

export type ErrorCode = "missing_key" | "auth" | "rate_limited" | "upstream" | "timeout" | "invalid" | "unsupported_model" | "kimi_unavailable" | "kimi_confirm" | "vision_unavailable" | "large_context" | "throttled" | "busy" | "duplicate" | "not_found" | "unauthorized" | "unknown";

export class PublicError extends Error {
  constructor(message: string, public status = 500, public code: ErrorCode = "unknown") { super(message); }
}

export function groqKey() {
  const key = process.env["GROQ_API_KEY"];
  if (!key) throw new PublicError("Exodus isn’t connected to Groq yet.", 503, "missing_key");
  return key;
}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((r, j) => { const t = setTimeout(r, ms); signal?.addEventListener("abort", () => { clearTimeout(t); j(new DOMException("Aborted", "AbortError")); }, { once: true }); });

/**
 * fetch with timeout and bounded exponential backoff + jitter.
 * Retries only 429 and temporary 5xx. Never retries 400/401/403/404/422.
 */
export async function groqFetch(path: string, init: RequestInit & { onRateLimit?: () => void }, maxRetries = limits.maxRetries): Promise<Response> {
  const key = groqKey();
  let last: Response | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const timeout = AbortSignal.timeout(limits.requestTimeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    let res: Response;
    try {
      res = await fetch(`${GROQ_BASE}${path}`, { ...init, signal, headers: { Authorization: `Bearer ${key}`, ...(init.headers ?? {}) } });
    } catch (e) {
      if (init.signal?.aborted) throw e;
      if (timeout.aborted) throw new PublicError("Groq took too long to respond. Please try again.", 504, "timeout");
      if (attempt < maxRetries) { await sleep(400 * 2 ** attempt + Math.random() * 300, init.signal ?? undefined); continue; }
      throw new PublicError("Exodus couldn’t reach Groq. Check your connection and try again.", 502, "upstream");
    }
    if (res.ok) return res;
    last = res;
    const retryable = res.status === 429 || res.status === 500 || res.status === 502 || res.status === 503 || res.status === 504;
    if (res.status === 429) init.onRateLimit?.();
    if (!retryable || attempt === maxRetries) break;
    const retryAfter = Number(res.headers.get("retry-after"));
    const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 8000) : 500 * 2 ** attempt + Math.random() * 400;
    await res.body?.cancel().catch(() => {});
    await sleep(wait, init.signal ?? undefined);
  }
  const status = last?.status ?? 502;
  const text = (await last?.text().catch(() => "")) ?? "";
  console.error("[groq]", path, status, text.slice(0, 300));
  throw normalizeStatus(status, text);
}

function normalizeStatus(status: number, text: string) {
  if (status === 429) return new PublicError("Groq is rate limiting requests right now. Wait a moment and try again.", 429, "rate_limited");
  if (status === 401 || status === 403) return new PublicError("Groq rejected Exodus’s connection key.", 502, "auth");
  if (status === 404 || /model.*(not found|does not exist|decommissioned)/i.test(text)) return new PublicError("That model isn’t available on your Groq account.", 400, "unsupported_model");
  if (status === 400 || status === 413 || status === 422) return new PublicError(/context|too long|tokens/i.test(text) ? "This request is too large for the selected model. Try a shorter message or start a new chat." : "Groq couldn’t process that request.", 400, "invalid");
  return new PublicError("Groq is temporarily unavailable. Please try again.", 502, "upstream");
}

export async function availableModels(force = false): Promise<Set<string>> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.ids;
  const res = await groqFetch("/models", { method: "GET" }, 1);
  const json = (await res.json()) as { data?: { id: string; active?: boolean }[] };
  const ids = new Set((json.data ?? []).filter((m) => m.active !== false).map((m) => m.id));
  cache = { at: Date.now(), ids };
  return ids;
}

export async function availability(): Promise<{ availability: Availability; keyStatus: "connected" | "missing" | "error"; checkedAt: number | null }> {
  const keys = [...(Object.keys(profiles) as ProfileKey[]), "voice", "speak"] as const;
  const unknown = Object.fromEntries(keys.map((k) => [k, "unknown"])) as Availability;
  try {
    const ids = await availableModels();
    const out = {} as Availability;
    (Object.keys(profiles) as ProfileKey[]).forEach((k) => (out[k] = ids.has(profiles[k].modelId) ? "available" : "unavailable"));
    out.voice = ids.has(audio.transcribe.modelId) ? "available" : "unavailable";
    out.speak = ids.has(audio.speak.modelId) ? "available" : "unavailable";
    return { availability: out, keyStatus: "connected", checkedAt: cache?.at ?? Date.now() };
  } catch (e) {
    const missing = e instanceof PublicError && e.code === "missing_key";
    return { availability: unknown, keyStatus: missing ? "missing" : "error", checkedAt: null };
  }
}

export type Resolution = { profile: ModelProfile; requested: ModelProfile; fallbackUsed: boolean; fallbackReason: string | null };

/** Applies the model policy. Kimi never falls back without explicit confirmation; Vision never falls back. */
export async function resolveProfile(requestedKey: ProfileKey, allowKimiFallback: boolean): Promise<Resolution> {
  const ids = await availableModels();
  const requested = profiles[requestedKey];
  if (ids.has(requested.modelId)) return { profile: requested, requested, fallbackUsed: false, fallbackReason: null };
  if (requestedKey === "kimi") {
    if (!allowKimiFallback) throw new PublicError(KIMI_UNAVAILABLE, 409, "kimi_unavailable");
    if (allowKimiFallback && ids.has(profiles.deep.modelId)) return { profile: profiles.deep, requested, fallbackUsed: true, fallbackReason: "Kimi K2 unavailable; user confirmed Deep Reason" };
    throw new PublicError("Kimi K2 and Deep Reason are both unavailable right now.", 503, "kimi_unavailable");
  }
  if (requestedKey === "vision") throw new PublicError("Vision is unavailable right now, so Exodus can’t look at images. Remove the image to continue with text.", 409, "vision_unavailable");
  const seen = new Set<ProfileKey>([requestedKey]);
  let key = requested.fallback;
  while (key && !seen.has(key)) {
    seen.add(key);
    if (ids.has(profiles[key].modelId)) return { profile: profiles[key], requested, fallbackUsed: true, fallbackReason: `${requested.label} unavailable` };
    key = profiles[key].fallback;
  }
  throw new PublicError(`${requested.label} and its fallback are unavailable right now.`, 503, "unsupported_model");
}

export { KIMI_CONFIRM };

// ---- Per-user throttling and one active generation per conversation (per server instance). ----
const hits = new Map<string, number[]>();
export function throttle(userId: string) {
  const now = Date.now();
  const list = (hits.get(userId) ?? []).filter((t) => now - t < 60_000);
  if (list.length >= limits.requestsPerMinute) throw new PublicError("You’re sending requests very quickly. Please wait a few seconds.", 429, "throttled");
  list.push(now);
  hits.set(userId, list);
}
const active = new Set<string>();
export function claimConversation(id: string) {
  if (active.has(id)) throw new PublicError("Exodus is already answering in this conversation.", 409, "busy");
  active.add(id);
  return () => active.delete(id);
}

export async function requireUser(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token.split(".").length !== 3) throw new PublicError("Please sign in again.", 401, "unauthorized");
  const url = process.env["SUPABASE_URL"]!;
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  const supabase = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { Authorization: `Bearer ${token}` },
      fetch: (input, init) => { const h = new Headers(init?.headers); h.set("apikey", key); return fetch(input, { ...init, headers: h }); },
    },
  });
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims?.sub) throw new PublicError("Please sign in again.", 401, "unauthorized");
  return { supabase, userId: data.claims.sub as string };
}

export function errorResponse(e: unknown) {
  if (e instanceof PublicError) return Response.json({ error: e.message, code: e.code }, { status: e.status });
  console.error(e);
  return Response.json({ error: "Something went wrong. Please try again.", code: "unknown" }, { status: 500 });
}

/** One-shot utility completion (titles etc.) using the Fast profile. */
export async function utilityCompletion(prompt: string) {
  const { profile } = await resolveProfile("fast", false);
  const res = await groqFetch("/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: profile.modelId, messages: [{ role: "user", content: prompt }], max_tokens: 40, temperature: 0.3 }),
  }, 0);
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return (json.choices?.[0]?.message?.content ?? "").trim();
}
