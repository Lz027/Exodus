import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Check, Copy, ImagePlus, Loader2, Mic, Pencil, RotateCcw, Square, Volume2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Conversation, ConversationContent, ConversationScrollButton } from "@/components/ai-elements/conversation";
import { MessageResponse } from "@/components/ai-elements/message";
import { AiError, api, prefs, q, speak, streamChat, transcribe, useModels, type Message, type Workspace } from "@/lib/exodus-api";
import { defaultProfileFor, KIMI_CONFIRM, KIMI_UNAVAILABLE, limits, profiles, type ProfileKey } from "@/lib/ai/registry";
import { cn } from "@/lib/utils";
import { ModelSelect } from "./model-select";

type Live = { text: string; label: string; notice: string; status: "waiting" | "streaming" };
type Failure = { message: string; code: string };
type Pending = { kind: "kimi" | "large"; run: (o: { allowKimiFallback?: boolean; confirmLarge?: boolean }) => void } | null;

const suggestions: Record<Workspace, string[]> = {
  general: ["Help me plan my week around two deadlines", "Turn these notes into a clear outline", "Compare two options and recommend one"],
  coding: ["Plan the data model for a small booking app", "Review this function for edge cases", "Explain how to structure a TanStack Start project"],
};

export function ChatView({ conversationId, workspace, projectId }: { conversationId: string | null; workspace: Workspace; projectId: string | null }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const models = useModels();
  const avail = models.data?.availability;
  const { data: messages = [] } = useQuery({ ...q.messages(conversationId ?? "none"), enabled: !!conversationId });
  const [profile, setProfile] = useState<ProfileKey>(() => defaultProfileFor(workspace));
  const [draft, setDraft] = useState("");
  const [images, setImages] = useState<{ name: string; url: string }[]>([]);
  const [live, setLive] = useState<Live | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sendingRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const convoRef = useRef<string | null>(conversationId);
  convoRef.current = conversationId ?? convoRef.current;

  useEffect(() => { setProfile(defaultProfileFor(workspace)); }, [workspace]);
  useEffect(() => { inputRef.current?.focus(); }, [conversationId]);
  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => { // auto-grow composer
    const el = inputRef.current; if (!el) return; el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 260)}px`;
  }, [draft]);

  const busy = !!live || sendingRef.current;

  async function run(convId: string, opts: { allowKimiFallback?: boolean; confirmLarge?: boolean; images?: string[] } = {}) {
    const ctrl = new AbortController(); abortRef.current = ctrl;
    setFailure(null); setLive({ text: "", label: profiles[opts.images?.length ? "vision" : profile].label, notice: "", status: "waiting" });
    const requestId = crypto.randomUUID();
    try {
      await streamChat({ conversationId: convId, profile, clientRequestId: requestId, ...opts }, ctrl.signal, (e) => {
        if (e.type === "meta") setLive((l) => l && { ...l, label: e.label, notice: e.notice });
        else if (e.type === "delta") setLive((l) => l && { ...l, text: l.text + e.text, status: "streaming" });
        else if (e.type === "error") setFailure({ message: e.error, code: "upstream" });
      });
    } catch (err) {
      if (ctrl.signal.aborted) { /* stopped: server saves partial text */ }
      else if (err instanceof AiError && err.code === "kimi_unavailable" && !opts.allowKimiFallback) {
        if (prefs.get("kimiFallback", false)) setPending({ kind: "kimi", run: (o) => void run(convId, { ...opts, ...o }) });
        else setFailure({ message: KIMI_UNAVAILABLE, code: err.code });
      } else if (err instanceof AiError && err.code === "large_context") setPending({ kind: "large", run: (o) => void run(convId, { ...opts, ...o }) });
      else setFailure({ message: err instanceof Error ? err.message : "Something went wrong.", code: err instanceof AiError ? err.code : "unknown" });
    } finally {
      if (ctrl.signal.aborted) await new Promise((r) => setTimeout(r, 400)); // let the server save the stopped reply
      abortRef.current = null; sendingRef.current = false;
      await Promise.all([qc.invalidateQueries({ queryKey: ["messages", convId] }), qc.invalidateQueries({ queryKey: ["conversations"] })]);
      setLive(null);
    }
  }

  async function send(text = draft) {
    const content = text.trim();
    if ((!content && !images.length) || busy || sendingRef.current) return; // duplicate protection
    if (images.length && avail?.vision !== "available") { setFailure({ message: "Vision is unavailable right now, so Exodus can’t look at images. Remove the image to continue with text.", code: "vision_unavailable" }); return; }
    sendingRef.current = true;
    const imgs = images.map((i) => i.url);
    try {
      let id = convoRef.current;
      if (!id) {
        const c = await api.createConversation(workspace, projectId, profile);
        id = c.id; convoRef.current = id;
        qc.invalidateQueries({ queryKey: ["conversations"] });
        navigate({ to: "/chat/$threadId", params: { threadId: id }, replace: true });
      }
      await api.addUserMessage(id, content || "What’s in this image?", crypto.randomUUID(), images.map((i) => ({ type: "image", name: i.name })));
      setDraft(""); setImages([]);
      await qc.invalidateQueries({ queryKey: ["messages", id] });
      await run(id, imgs.length ? { images: imgs } : {});
    } catch (err) {
      sendingRef.current = false;
      toast.error(err instanceof Error ? err.message : "Couldn’t send that message.");
    }
  }

  const stop = () => abortRef.current?.abort();
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const lastUser = [...messages].reverse().find((m) => m.role === "user");

  async function regenerate() {
    if (!conversationId || busy || !lastUser) return;
    sendingRef.current = true;
    await api.deleteMessagesAfter(conversationId, lastUser.created_at);
    await qc.invalidateQueries({ queryKey: ["messages", conversationId] });
    await run(conversationId);
  }
  async function retry() { if (conversationId && !busy) { sendingRef.current = true; if (lastAssistant && lastAssistant.created_at > (lastUser?.created_at ?? "")) await api.deleteMessagesAfter(conversationId, lastUser!.created_at); await run(conversationId); } }
  async function saveEdit(m: Message, text: string) {
    if (!conversationId || busy || !text.trim()) return;
    sendingRef.current = true; setEditing(null);
    await api.updateMessage(m.id, text.trim());
    await api.deleteMessagesAfter(conversationId, m.created_at);
    await qc.invalidateQueries({ queryKey: ["messages", conversationId] });
    await run(conversationId);
  }

  const addImages = async (files: FileList | null) => {
    if (!files) return;
    for (const f of Array.from(files).slice(0, limits.maxImages - images.length)) {
      if (!f.type.startsWith("image/")) { toast.error(`${f.name} isn’t an image.`); continue; }
      if (f.size > limits.maxImageBytes) { toast.error(`${f.name} is larger than 4 MB.`); continue; }
      const url = await new Promise<string>((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result)); fr.readAsDataURL(f); });
      setImages((v) => [...v, { name: f.name, url }]);
    }
    if (avail?.vision === "unavailable") toast("Vision is unavailable right now. Remove the image to send text only.");
  };

  const empty = !messages.length && !live;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Conversation>
        <ConversationContent className="mx-auto w-full max-w-[46rem] gap-8 px-5 pb-10 pt-10 md:px-8">
          {empty ? <Welcome workspace={workspace} onPick={(s) => { setDraft(s); inputRef.current?.focus(); }} /> : messages.map((m) => m.role === "user"
            ? <UserMessage key={m.id} m={m} editing={editing === m.id} busy={busy} onEdit={() => setEditing(m.id)} onCancel={() => setEditing(null)} onSave={(t) => void saveEdit(m, t)} />
            : <AssistantMessage key={m.id} m={m} isLast={m.id === lastAssistant?.id && !live} busy={busy} onRegenerate={() => void regenerate()} />)}
          {live && <div className="grid gap-2">
            <ModelTag label={live.label} />
            {live.notice && <Notice text={live.notice} />}
            {live.text ? <MessageResponse className="prose-exodus" isAnimating>{live.text}</MessageResponse> : <div className="flex items-center gap-2 text-sm text-muted-foreground"><span className="size-1.5 animate-pulse rounded-full bg-primary" />Thinking…</div>}
          </div>}
          {failure && !live && <div role="alert" className="rounded-lg border border-danger/25 bg-surface px-4 py-3 text-sm">
            <p className="text-foreground">{failure.message}</p>
            <div className="mt-2 flex gap-2">{failure.code !== "vision_unavailable" && <Button size="sm" variant="outline" className="press" onClick={() => void retry()}><RotateCcw />Try again</Button>}{failure.code === "kimi_unavailable" && <Button size="sm" variant="ghost" onClick={() => navigate({ to: "/settings" })}>Fallback settings</Button>}<Button size="sm" variant="ghost" onClick={() => setFailure(null)}>Dismiss</Button></div>
          </div>}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="shrink-0 px-3 pb-3 md:px-6 md:pb-5">
        <div className="mx-auto max-w-[46rem]">
          <Composer
            draft={draft} setDraft={setDraft} inputRef={inputRef} images={images} setImages={setImages} onImages={addImages}
            busy={busy} streaming={!!live} onSend={() => void send()} onStop={stop} profile={profile} setProfile={setProfile} avail={avail}
            placeholder={workspace === "coding" ? "Describe what you want to build…" : "Ask anything…"} voiceOk={avail?.voice !== "unavailable"}
          />
          <p className="mt-2 text-center text-[11px] text-muted-foreground">Exodus can make mistakes. Check important details.</p>
        </div>
      </div>

      <AlertDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>{pending?.kind === "kimi" ? "Kimi K2 is unavailable" : "Large request"}</AlertDialogTitle><AlertDialogDescription>{pending?.kind === "kimi" ? KIMI_CONFIRM : "This request includes a large project context and may use more tokens than usual. Continue?"}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => { const p = pending; setPending(null); if (p) { sendingRef.current = true; p.run(p.kind === "kimi" ? { allowKimiFallback: true } : { confirmLarge: true }); } }}>{pending?.kind === "kimi" ? "Use Deep Reason" : "Continue"}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Welcome({ workspace, onPick }: { workspace: Workspace; onPick: (s: string) => void }) {
  return <div className="flex min-h-[46vh] flex-col justify-end pb-4">
    <h1 className="text-[28px] font-semibold tracking-tight">{workspace === "coding" ? "What are we building?" : "What’s on your mind?"}</h1>
    <p className="mt-2 max-w-lg text-[15px] leading-7 text-muted-foreground">{workspace === "coding" ? "Kimi K2 handles coding here. Describe the product, the problem, or paste the code you’re working on." : "Think through an idea, shape a project, or bring a loose thread into focus."}</p>
    <div className="mt-6 grid gap-1">{suggestions[workspace].map((s) => <button key={s} type="button" onClick={() => onPick(s)} className="press -mx-2 rounded-md px-2 py-2 text-left text-[14px] text-muted-foreground hover:bg-muted hover:text-foreground">{s}</button>)}</div>
  </div>;
}

const ModelTag = ({ label, fallback }: { label: string; fallback?: boolean }) => <div className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground"><span className="size-1.5 rounded-full bg-primary" />{label}{fallback && <span className="font-normal">· fallback</span>}</div>;
const Notice = ({ text }: { text: string }) => <div className="w-fit rounded-md bg-warning-muted px-2.5 py-1 text-[12px] text-warning">{text}</div>;

function IconAction({ label, onClick, children, disabled }: { label: string; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return <Tooltip><TooltipTrigger asChild><button type="button" aria-label={label} disabled={disabled} onClick={onClick} className="press grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 [&_svg]:size-3.5">{children}</button></TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>;
}

function UserMessage({ m, editing, busy, onEdit, onCancel, onSave }: { m: Message; editing: boolean; busy: boolean; onEdit: () => void; onCancel: () => void; onSave: (t: string) => void }) {
  const [text, setText] = useState(m.content);
  const atts = Array.isArray(m.attachments) ? (m.attachments as { name?: string }[]) : [];
  if (editing) return <div className="ml-auto w-full max-w-[85%] rounded-lg border border-primary/40 bg-surface p-2">
    <Textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} className="min-h-20 border-0 shadow-none focus-visible:ring-0" />
    <div className="flex justify-end gap-2"><Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button><Button size="sm" className="press" onClick={() => onSave(text)}>Save & resend</Button></div>
  </div>;
  return <div className="group ml-auto flex max-w-[85%] flex-col items-end gap-1">
    <div className="rounded-lg bg-chat-user px-3.5 py-2.5 text-[15px] leading-7 whitespace-pre-wrap text-chat-user-foreground">{m.content}</div>
    {atts.length > 0 && <div className="text-[11px] text-muted-foreground">{atts.map((a) => a.name).join(", ")}</div>}
    <div className="flex opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"><IconAction label="Edit and resend" disabled={busy} onClick={onEdit}><Pencil /></IconAction></div>
  </div>;
}

function AssistantMessage({ m, isLast, busy, onRegenerate }: { m: Message; isLast: boolean; busy: boolean; onRegenerate: () => void }) {
  const [copied, setCopied] = useState(false);
  const [voice, setVoice] = useState<"idle" | "loading" | "playing">("idle");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => () => { audioRef.current?.pause(); ctrl.current?.abort(); }, []);
  const copy = async () => { await navigator.clipboard.writeText(m.content); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  const toggleSpeak = async () => {
    if (voice !== "idle") { audioRef.current?.pause(); ctrl.current?.abort(); setVoice("idle"); return; }
    setVoice("loading"); ctrl.current = new AbortController();
    try {
      const url = await speak(m.content, ctrl.current.signal);
      const a = new Audio(url); audioRef.current = a; a.onended = () => { setVoice("idle"); URL.revokeObjectURL(url); };
      await a.play(); setVoice("playing");
    } catch (e) { setVoice("idle"); if (!(e instanceof DOMException)) toast.error(e instanceof Error ? e.message : "Couldn’t read this aloud.", { action: { label: "Retry", onClick: () => void toggleSpeak() } }); }
  };
  return <div className="group grid gap-2">
    <ModelTag label={m.model_label ?? "Exodus"} fallback={m.fallback_used} />
    {m.fallback_used && <Notice text={m.fallback_reason ? `Fallback used: ${m.fallback_reason}.` : "A fallback model answered this message."} />}
    <MessageResponse className="prose-exodus">{m.content}</MessageResponse>
    {m.status === "stopped" && <div className="text-[12px] text-muted-foreground">Stopped</div>}
    {m.status === "error" && <div className="text-[12px] text-danger">This response was interrupted.</div>}
    <div className={cn("-ml-1.5 flex gap-0.5 transition-opacity", isLast ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-within:opacity-100")}>
      <IconAction label={copied ? "Copied" : "Copy"} onClick={() => void copy()}>{copied ? <Check /> : <Copy />}</IconAction>
      {isLast && <IconAction label="Regenerate" disabled={busy} onClick={onRegenerate}><RotateCcw /></IconAction>}
      <IconAction label={voice === "idle" ? "Speak" : "Stop speaking"} onClick={() => void toggleSpeak()}>{voice === "loading" ? <Loader2 className="animate-spin" /> : voice === "playing" ? <Square /> : <Volume2 />}</IconAction>
    </div>
  </div>;
}

function Composer(p: { draft: string; setDraft: (v: string) => void; inputRef: React.RefObject<HTMLTextAreaElement | null>; images: { name: string; url: string }[]; setImages: (f: (v: { name: string; url: string }[]) => { name: string; url: string }[]) => void; onImages: (f: FileList | null) => void; busy: boolean; streaming: boolean; onSend: () => void; onStop: () => void; profile: ProfileKey; setProfile: (k: ProfileKey) => void; avail: ReturnType<typeof useModels>["data"] extends infer T ? T extends { availability: infer A } ? A | undefined : undefined : undefined; placeholder: string; voiceOk: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rec, setRec] = useState<{ r: MediaRecorder; start: number } | null>(null);
  const [secs, setSecs] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  useEffect(() => { if (!rec) return; const t = setInterval(() => setSecs(Math.floor((Date.now() - rec.start) / 1000)), 250); return () => clearInterval(t); }, [rec]);

  const toggleMic = async () => {
    if (rec) { rec.r.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream); const chunks: Blob[] = [];
      r.ondataavailable = (e) => chunks.push(e.data);
      r.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop()); setRec(null); setSecs(0); setTranscribing(true);
        try { const text = await transcribe(new Blob(chunks, { type: r.mimeType })); if (text) p.setDraft(p.draft ? `${p.draft} ${text}` : text); else toast("No speech was detected."); p.inputRef.current?.focus(); }
        catch (e) { toast.error(e instanceof Error ? e.message : "Couldn’t transcribe that recording."); }
        finally { setTranscribing(false); }
      };
      r.start(); setRec({ r, start: Date.now() });
    } catch { toast.error("Microphone access was blocked. Allow it in your browser to use Voice."); }
  };

  const canSend = (p.draft.trim() || p.images.length) && !p.busy;
  return <div className="rounded-xl border border-border bg-surface shadow-composer transition-colors focus-within:border-magenta-200">
    {p.images.length > 0 && <div className="flex flex-wrap gap-2 px-3 pt-3">{p.images.map((img, i) => <div key={i} className="relative">
      <img src={img.url} alt={img.name} className="size-16 rounded-md border border-border object-cover" />
      <button type="button" aria-label={`Remove ${img.name}`} onClick={() => p.setImages((v) => v.filter((_, j) => j !== i))} className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full border border-border bg-surface text-muted-foreground hover:text-foreground"><X className="size-3" /></button>
    </div>)}</div>}
    <textarea
      ref={p.inputRef} value={p.draft} onChange={(e) => p.setDraft(e.target.value)} rows={1} placeholder={p.placeholder} aria-label="Message"
      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (canSend) p.onSend(); } }}
      className="block max-h-[260px] min-h-[56px] w-full resize-none bg-transparent px-4 pt-4 pb-2 text-[15px] leading-7 outline-none placeholder:text-muted-foreground focus-visible:outline-none"
    />
    <div className="flex items-center gap-1 px-2 pb-2">
      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { p.onImages(e.target.files); e.target.value = ""; }} />
      <IconAction label="Attach image" onClick={() => fileRef.current?.click()}><ImagePlus /></IconAction>
      <Tooltip><TooltipTrigger asChild><button type="button" aria-label={rec ? "Stop recording" : "Voice input"} disabled={!p.voiceOk || transcribing} onClick={() => void toggleMic()} className={cn("press inline-flex h-7 items-center gap-1.5 rounded-md px-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 [&_svg]:size-3.5", rec && "bg-magenta-50 text-primary")}>{transcribing ? <Loader2 className="animate-spin" /> : <Mic />}{rec && <span className="text-[12px] tabular-nums">{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}</span>}</button></TooltipTrigger><TooltipContent>{p.voiceOk ? (rec ? "Stop and transcribe" : "Voice input") : "Voice is unavailable"}</TooltipContent></Tooltip>
      <div className="mx-1 h-4 w-px bg-border" />
      <ModelSelect value={p.profile} onChange={p.setProfile} availability={p.avail} />
      <div className="flex-1" />
      {p.streaming
        ? <button type="button" onClick={p.onStop} aria-label="Stop generating" className="press grid size-8 place-items-center rounded-md bg-foreground text-background hover:opacity-90"><Square className="size-3.5 fill-current" /></button>
        : <button type="button" onClick={p.onSend} disabled={!canSend} aria-label="Send message" className="press grid size-8 place-items-center rounded-md bg-primary text-primary-foreground hover:bg-primary-hover disabled:bg-magenta-100 disabled:text-primary-foreground"><ArrowUp className="size-4" /></button>}
    </div>
  </div>;
}
