import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { audio, profiles, type Availability, type ProfileKey } from "./registry";

export const GROQ_BASE = "https://api.groq.com/openai/v1";
const CACHE_MS = 5 * 60 * 1000;
let cache: { at: number; ids: Set<string> } | null = null;

export function groqKey() {
  const key = process.env["GROQ_API_KEY"];
  if (!key) throw new PublicError("Exodus isn’t connected to its AI provider yet.", 503);
  return key;
}

export class PublicError extends Error {
  constructor(message: string, public status = 500) { super(message); }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** fetch with bounded exponential backoff + jitter on 429/5xx. */
export async function groqFetch(path: string, init: RequestInit, attempts = 3): Promise<Response> {
  let last: Response | null = null;
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(`${GROQ_BASE}${path}`, { ...init, headers: { Authorization: `Bearer ${groqKey()}`, ...(init.headers ?? {}) } });
    if (res.ok) return res;
    last = res;
    if (res.status !== 429 && res.status < 500) break;
    if (i < attempts - 1) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 8000) : 400 * 2 ** i + Math.random() * 300;
      await sleep(wait);
    }
  }
  const status = last?.status ?? 502;
  console.error("[groq]", path, status, await last?.text().catch(() => ""));
  throw new PublicError(
    status === 429 ? "Exodus is busy right now. Please try again in a moment." : status === 401 ? "The AI provider rejected Exodus’s connection key." : "The AI provider didn’t respond. Please try again.",
    status === 429 ? 429 : 502,
  );
}

export async function availableModels(force = false): Promise<Set<string>> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.ids;
  const res = await groqFetch("/models", { method: "GET" });
  const json = (await res.json()) as { data?: { id: string; active?: boolean }[] };
  const ids = new Set((json.data ?? []).filter((m) => m.active !== false).map((m) => m.id));
  cache = { at: Date.now(), ids };
  return ids;
}

export async function availability(): Promise<Availability> {
  const ids = await availableModels();
  const out = {} as Availability;
  (Object.keys(profiles) as ProfileKey[]).forEach((k) => (out[k] = ids.has(profiles[k].modelId)));
  out.voice = ids.has(audio.transcribe.modelId);
  out.speak = ids.has(audio.speak.modelId);
  return out;
}

/** Follow the fallback chain until an available model is found. */
export async function resolveProfile(requested: ProfileKey) {
  const ids = await availableModels();
  const seen = new Set<ProfileKey>();
  let key: ProfileKey | undefined = requested;
  while (key && !seen.has(key)) {
    seen.add(key);
    if (ids.has(profiles[key].modelId)) return { profile: profiles[key], fallbackUsed: key !== requested };
    key = profiles[key].fallback;
  }
  throw new PublicError(`${profiles[requested].label} and its fallbacks are unavailable right now.`, 503);
}

export async function requireUser(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token.split(".").length !== 3) throw new PublicError("Please sign in again.", 401);
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
  if (error || !data?.claims?.sub) throw new PublicError("Please sign in again.", 401);
  return { supabase, userId: data.claims.sub as string };
}

export function errorResponse(e: unknown) {
  if (e instanceof PublicError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
}

/** One-shot utility completion (titles etc.) using the Fast profile. */
export async function utilityCompletion(prompt: string) {
  const { profile } = await resolveProfile("fast");
  const res = await groqFetch("/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: profile.modelId, messages: [{ role: "user", content: prompt }], max_tokens: 400, temperature: 0.3 }),
  });
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return (json.choices?.[0]?.message?.content ?? "").trim();
}
