import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { Brain, Check, ChevronLeft, Code2, Download, File, Folder, LogOut, Menu, MessageCircle, MoreHorizontal, PanelRightClose, PanelRightOpen, Pencil, Pin, Plus, Settings, SquarePen, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { api, clearUsage, fetchUsage, prefs, q, sessionStart, useModels, useSession, type Conversation, type Project, type Workspace } from "@/lib/exodus-api";
import { chatProfileOrder, profiles } from "@/lib/ai/registry";
import { cn } from "@/lib/utils";
import { ExodusBrand } from "./brand";
import { ChatView } from "./chat-view";
import { NewProjectDialog } from "./new-project-dialog";

type Page = { kind: "chat"; threadId: string } | { kind: "project"; projectId: string } | { kind: "settings" };
const fmt = (d: string) => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export function WorkspaceShell({ page }: { page: Page }) {
  const navigate = useNavigate();
  const { session, ready } = useSession();
  useEffect(() => { if (ready && !session) navigate({ to: "/", replace: true }); }, [ready, session, navigate]);
  if (!ready || !session) return <div className="grid h-dvh place-items-center text-sm text-muted-foreground">Opening your workspace…</div>;
  return <Shell page={page} />;
}

function Shell({ page }: { page: Page }) {
  const navigate = useNavigate();
  const { data: projects = [] } = useQuery(q.projects());
  const { data: convos = [], isLoading } = useQuery(q.conversations());
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [ctxOpen, setCtxOpen] = useState(() => prefs.get("ctx", true));
  const [newProject, setNewProject] = useState(false);
  const [newWorkspace, setNewWorkspace] = useState<Workspace>(() => prefs.get("workspace", "general"));
  const [activeProject, setActiveProject] = useState<string | null>(() => prefs.get("project", null));
  useEffect(() => prefs.set("ctx", ctxOpen), [ctxOpen]);

  const convo = page.kind === "chat" && page.threadId !== "new" ? convos.find((c) => c.id === page.threadId) : undefined;
  const missing = page.kind === "chat" && page.threadId !== "new" && !isLoading && !convo;
  const workspace: Workspace = (convo?.workspace_type as Workspace) ?? newWorkspace;
  const projectId = page.kind === "project" ? page.projectId : convo ? convo.project_id : activeProject;
  const project = projects.find((p) => p.id === projectId) ?? null;

  const newChat = (ws: Workspace = workspace) => { setNewWorkspace(ws); prefs.set("workspace", ws); setMobileNav(false); navigate({ to: "/chat/$threadId", params: { threadId: "new" } }); };
  const pickProject = (id: string | null) => { setActiveProject(id); prefs.set("project", id); };

  const sidebar = <Sidebar collapsed={collapsed && !mobileNav} convos={convos} projects={projects} activeId={convo?.id} workspace={page.kind === "chat" ? workspace : null}
    onNew={newChat} onProject={() => setNewProject(true)} onToggle={() => (mobileNav ? setMobileNav(false) : setCollapsed(!collapsed))} onNavigate={() => setMobileNav(false)} />;
  const title = page.kind === "settings" ? "Models and usage" : page.kind === "project" ? project?.name ?? "Project" : convo?.title ?? "New conversation";

  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      <aside className={cn("hidden shrink-0 flex-col border-r border-border bg-sidebar transition-[width] duration-200 md:flex", collapsed ? "w-16" : "w-64")}>{sidebar}</aside>
      <Drawer open={mobileNav} onOpenChange={setMobileNav} direction="left"><DrawerContent className="w-[min(88vw,19rem)] md:hidden"><DrawerTitle className="sr-only">Navigation</DrawerTitle><div className="flex h-full flex-col">{sidebar}</div></DrawerContent></Drawer>
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 px-3 md:px-5">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu /></Button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[11px] text-muted-foreground">{page.kind === "chat" ? (workspace === "coding" ? "Coding Workspace" : "General") : page.kind === "project" ? "Project" : "Settings"}{project && page.kind === "chat" ? ` · ${project.name}` : ""}</div>
            <div className="truncate text-sm font-medium">{title}</div>
          </div>
          {page.kind === "chat" && !convo && <ProjectPicker projects={projects} value={activeProject} onChange={pickProject} />}
          {convo && <ConversationMenu convo={convo} />}
          <Button variant="ghost" size="icon" onClick={() => setCtxOpen(!ctxOpen)} aria-label={ctxOpen ? "Close context panel" : "Open context panel"}>{ctxOpen ? <PanelRightClose /> : <PanelRightOpen />}</Button>
        </header>
        <div className="flex min-h-0 flex-1">
          <section className="min-w-0 flex-1">
            {page.kind === "chat" && (missing ? <Empty title="Conversation not found" text="It may have been deleted." action={<Button onClick={() => newChat()}>Start a new chat</Button>} /> : <ChatView key={convo?.id ?? `new-${workspace}`} conversationId={convo?.id ?? null} workspace={workspace} projectId={projectId} />)}
            {page.kind === "project" && (project ? <ProjectOverview project={project} convos={convos.filter((c) => c.project_id === project.id)} onChat={() => { pickProject(project.id); newChat("coding"); }} /> : <Empty title="Project not found" text="It may have been deleted." />)}
            {page.kind === "settings" && <SettingsView />}
          </section>
          {ctxOpen && <aside className="hidden w-80 shrink-0 border-l border-border bg-surface xl:block"><ContextPanel project={project} onClose={() => setCtxOpen(false)} /></aside>}
        </div>
      </main>
      <Drawer open={ctxOpen && typeof window !== "undefined" && window.innerWidth < 1280} onOpenChange={setCtxOpen}><DrawerContent className="h-[80dvh] xl:hidden"><DrawerTitle className="sr-only">Context</DrawerTitle><ContextPanel project={project} onClose={() => setCtxOpen(false)} /></DrawerContent></Drawer>
      <NewProjectDialog open={newProject} onOpenChange={setNewProject} onCreated={(p) => { pickProject(p.id); navigate({ to: "/project/$projectId", params: { projectId: p.id } }); }} />
    </div>
  );
}

function Sidebar({ collapsed, convos, projects, activeId, workspace, onNew, onProject, onToggle, onNavigate }: { collapsed: boolean; convos: Conversation[]; projects: Project[]; activeId?: string; workspace: Workspace | null; onNew: (w?: Workspace) => void; onProject: () => void; onToggle: () => void; onNavigate: () => void }) {
  const navigate = useNavigate(); const qc = useQueryClient();
  const out = async () => { await api.signOut(); qc.clear(); navigate({ to: "/" }); };
  return <>
    <div className="flex h-14 items-center justify-between gap-2 px-3"><ExodusBrand compact={collapsed} /><Button variant="ghost" size="icon" onClick={onToggle} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>{collapsed ? <Menu /> : <ChevronLeft />}</Button></div>
    <div className="px-2"><Button variant="outline" className={cn("press w-full", collapsed ? "px-0" : "justify-start")} onClick={() => onNew()}><SquarePen />{!collapsed && "New chat"}</Button></div>
    <nav className="mt-4 min-h-0 flex-1 overflow-y-auto px-2 pb-3">
      <button type="button" className="nav-item w-full" data-status={workspace === "general" ? "active" : undefined} onClick={() => onNew("general")}><MessageCircle />{!collapsed && "General"}</button>
      <button type="button" className="nav-item w-full" data-status={workspace === "coding" ? "active" : undefined} onClick={() => onNew("coding")}><Code2 />{!collapsed && "Coding Workspace"}</button>
      {!collapsed && <>
        <div className="mt-5 flex items-center justify-between px-2"><Label>Projects</Label><Button variant="ghost" size="icon" className="size-7" onClick={onProject} aria-label="New project"><Plus /></Button></div>
        {projects.length ? projects.map((p) => <Link key={p.id} to="/project/$projectId" params={{ projectId: p.id }} onClick={onNavigate} className="nav-item"><Folder /><span className="truncate">{p.name}</span></Link>) : <button type="button" onClick={onProject} className="px-2 py-1.5 text-left text-[12px] text-muted-foreground hover:text-foreground">Create your first project</button>}
        <Label className="mt-5 px-2">Recent</Label>
        {convos.length ? convos.slice(0, 30).map((c) => <Link key={c.id} to="/chat/$threadId" params={{ threadId: c.id }} onClick={onNavigate} className="nav-item" data-status={c.id === activeId ? "active" : undefined}>{c.workspace_type === "coding" ? <Code2 /> : <MessageCircle />}<span className="truncate">{c.title}</span></Link>) : <p className="px-2 py-1.5 text-[12px] text-muted-foreground">Your conversations will appear here.</p>}
      </>}
    </nav>
    <div className="border-t border-border p-2"><Link to="/settings" onClick={onNavigate} className="nav-item"><Settings />{!collapsed && "Models and usage"}</Link><button type="button" onClick={() => void out()} className="nav-item w-full"><LogOut />{!collapsed && "Sign out"}</button></div>
  </>;
}
const Label = ({ children, className = "" }: { children: ReactNode; className?: string }) => <div className={cn("mb-1 text-[11px] font-medium text-muted-foreground", className)}>{children}</div>;
const Empty = ({ title, text, action }: { title: string; text: string; action?: ReactNode }) => <div className="grid h-full place-items-center p-8 text-center"><div><h2 className="text-lg font-semibold">{title}</h2><p className="mt-1 text-sm text-muted-foreground">{text}</p>{action && <div className="mt-4">{action}</div>}</div></div>;

function ProjectPicker({ projects, value, onChange }: { projects: Project[]; value: string | null; onChange: (id: string | null) => void }) {
  if (!projects.length) return null;
  const cur = projects.find((p) => p.id === value);
  return <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="hidden max-w-44 sm:inline-flex"><Folder /><span className="truncate">{cur?.name ?? "No project"}</span></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => onChange(null)}>No project</DropdownMenuItem>{projects.map((p) => <DropdownMenuItem key={p.id} onSelect={() => onChange(p.id)}>{p.name}{p.id === value && <Check className="ml-auto" />}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu>;
}

function ConversationMenu({ convo }: { convo: Conversation }) {
  const qc = useQueryClient(); const navigate = useNavigate();
  const [renaming, setRenaming] = useState(false); const [title, setTitle] = useState(convo.title); const [del, setDel] = useState(false);
  const save = async () => { if (!title.trim()) return; await api.renameConversation(convo.id, title.trim()); setRenaming(false); qc.invalidateQueries({ queryKey: ["conversations"] }); };
  return <>
    <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Conversation options"><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => { setTitle(convo.title); setRenaming(true); }}><Pencil />Rename</DropdownMenuItem><DropdownMenuItem className="text-danger" onSelect={() => setDel(true)}><Trash2 />Delete</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
    <AlertDialog open={renaming} onOpenChange={setRenaming}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Rename conversation</AlertDialogTitle></AlertDialogHeader><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} autoFocus onKeyDown={(e) => e.key === "Enter" && void save()} /><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => void save()}>Save</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <AlertDialog open={del} onOpenChange={setDel}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete this conversation?</AlertDialogTitle><AlertDialogDescription>All of its messages will be removed. This can’t be undone.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction className="bg-danger hover:bg-danger/90" onClick={async () => { await api.deleteConversation(convo.id); await qc.invalidateQueries({ queryKey: ["conversations"] }); toast.success("Conversation deleted"); navigate({ to: "/chat/$threadId", params: { threadId: "new" } }); }}>Delete</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </>;
}

function ProjectOverview({ project, convos, onChat }: { project: Project; convos: Conversation[]; onChat: () => void }) {
  const qc = useQueryClient(); const navigate = useNavigate(); const [del, setDel] = useState(false);
  const { data: tasks = [] } = useQuery(q.tasks(project.id));
  return <div className="h-full overflow-y-auto"><div className="mx-auto max-w-3xl px-5 py-10 md:px-8">
    <div className="flex flex-col gap-5 border-b border-border pb-8 sm:flex-row sm:items-end sm:justify-between">
      <div><div className="text-[12px] text-muted-foreground">{project.status} · {project.project_type} · Created {fmt(project.created_at)}</div><h1 className="mt-2 text-[28px] font-semibold tracking-tight">{project.name}</h1>{project.description && <p className="mt-2 max-w-xl text-[15px] leading-7 text-muted-foreground">{project.description}</p>}</div>
      <div className="flex gap-2"><Button className="press" onClick={onChat}><Code2 />Open in Coding</Button><Button variant="ghost" size="icon" aria-label="Delete project" onClick={() => setDel(true)}><Trash2 /></Button></div>
    </div>
    <dl className="review-list mt-6">{[["Starting stack", project.starting_stack || "Not decided"], ["Design direction", project.design_direction || "Not decided"], ["Complexity", project.complexity], ["Repository", project.repository_status]].map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
    <h2 className="mt-10 text-[15px] font-semibold">Conversations</h2>
    {convos.length ? <div className="mt-2">{convos.map((c) => <Link key={c.id} to="/chat/$threadId" params={{ threadId: c.id }} className="flex items-center gap-3 border-b border-border py-3 text-sm hover:text-primary"><MessageCircle className="size-4 text-muted-foreground" /><span className="flex-1 truncate">{c.title}</span><span className="text-xs text-muted-foreground">{fmt(c.updated_at)}</span></Link>)}</div> : <p className="mt-2 text-sm text-muted-foreground">No conversations yet. Open the project in Coding to start one.</p>}
    <h2 className="mt-10 text-[15px] font-semibold">Open tasks</h2>
    {tasks.filter((t) => t.status !== "Done").length ? tasks.filter((t) => t.status !== "Done").map((t) => <div key={t.id} className="flex items-center gap-3 border-b border-border py-3 text-sm"><span className={cn("size-1.5 rounded-full", t.status === "In progress" ? "bg-primary" : "bg-muted-foreground/40")} />{t.title}<span className="ml-auto text-xs text-muted-foreground">{t.status}</span></div>) : <p className="mt-2 text-sm text-muted-foreground">No open tasks. Add them from the context panel.</p>}
  </div>
    <AlertDialog open={del} onOpenChange={setDel}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete {project.name}?</AlertDialogTitle><AlertDialogDescription>Its conversations, messages, tasks, memory, files and activity will be permanently removed.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction className="bg-danger hover:bg-danger/90" onClick={async () => { await api.deleteProject(project.id); prefs.set("project", null); await qc.invalidateQueries(); toast.success("Project deleted"); navigate({ to: "/chat/$threadId", params: { threadId: "new" } }); }}>Delete project</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}

function SettingsView() {
  const models = useModels();
  const [fallback, setFallback] = useState(() => prefs.get("kimiFallback", false));
  const usage = useQuery({ queryKey: ["usage"], queryFn: () => fetchUsage(sessionStart()), refetchInterval: 30000 });
  const qc = useQueryClient();
  const key = models.data?.keyStatus;
  const stats: [string, number | string][] = usage.data ? [["Requests", usage.data.requests], ["Input tokens", usage.data.inputTokens], ["Output tokens", usage.data.outputTokens], ["Fallbacks", usage.data.fallbacks], ["Rate limits", usage.data.rateLimits], ["Errors", usage.data.errors]] : [];
  return <div className="h-full overflow-y-auto"><div className="mx-auto max-w-2xl px-5 py-10 md:px-8">
    <h1 className="text-[24px] font-semibold tracking-tight">Models and usage</h1>
    <div className="mt-6 flex items-center justify-between rounded-lg border border-border p-4"><div><div className="text-sm font-medium">Groq</div><div className="mt-0.5 text-[13px] text-muted-foreground">Key stored securely on the server · ••••••••</div></div><span className={cn("text-[13px] font-medium", key === "connected" ? "text-success" : key ? "text-danger" : "text-muted-foreground")}>{key === "connected" ? "Connected" : key === "missing" ? "Not connected" : key === "error" ? "Connection error" : "Checking…"}</span></div>
    <h2 className="mt-8 text-[15px] font-semibold">Models</h2>
    <div className="mt-2">{[...chatProfileOrder, "vision" as const].map((k) => { const s = models.data?.availability[k]; return <div key={k} className="flex items-center gap-3 border-b border-border py-3"><div className="min-w-0 flex-1"><div className="text-sm font-medium">{profiles[k].label}</div><div className="text-[12px] text-muted-foreground">{profiles[k].description}</div></div><span className={cn("text-[12px]", s === "available" ? "text-success" : s === "unavailable" ? "text-danger" : "text-muted-foreground")}>{s === "available" ? "Available" : s === "unavailable" ? "Unavailable" : "Checking"}</span></div>; })}</div>
    <div className="mt-6 flex items-start justify-between gap-4"><div><div className="text-sm font-medium">Offer Deep Reason when Kimi K2 is unavailable</div><div className="mt-0.5 text-[13px] text-muted-foreground">Exodus always asks before using it for a coding request.</div></div><Switch checked={fallback} onCheckedChange={(v) => { setFallback(v); prefs.set("kimiFallback", v); }} /></div>
    <div className="mt-10 flex items-center justify-between"><h2 className="text-[15px] font-semibold">This session</h2><Button variant="ghost" size="sm" onClick={async () => { await clearUsage(); qc.invalidateQueries({ queryKey: ["usage"] }); toast.success("Usage history cleared"); }}>Clear history</Button></div>
    {usage.isError ? <p className="mt-2 text-sm text-danger">Usage couldn’t be loaded.</p> : <div className="mt-3 grid grid-cols-2 gap-x-6 sm:grid-cols-3">{stats.map(([k, v]) => <div key={k} className="border-b border-border py-3"><div className="text-[12px] text-muted-foreground">{k}</div><div className="text-[17px] font-semibold tabular-nums">{Number(v).toLocaleString()}</div></div>)}</div>}
    {usage.data?.lastRequestAt && <p className="mt-3 text-[12px] text-muted-foreground">Last request {new Date(usage.data.lastRequestAt).toLocaleTimeString()}</p>}
  </div></div>;
}

function ContextPanel({ project, onClose }: { project: Project | null; onClose: () => void }) {
  return <div className="flex h-full flex-col">
    <div className="flex h-14 items-center justify-between px-4"><div className="text-sm font-medium">{project?.name ?? "Context"}</div><Button variant="ghost" size="icon" onClick={onClose} aria-label="Close context"><X /></Button></div>
    {!project ? <div className="p-5 text-sm leading-6 text-muted-foreground">Choose a project to see its files, tasks, memory and activity here.</div> :
      <Tabs defaultValue="tasks" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="mx-3 justify-start bg-transparent p-0">{["tasks", "memory", "files", "activity"].map((t) => <TabsTrigger key={t} value={t} className="capitalize data-[state=active]:bg-magenta-50 data-[state=active]:text-primary-strong data-[state=active]:shadow-none">{t}</TabsTrigger>)}</TabsList>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <TabsContent value="tasks" className="mt-0"><TasksTab pid={project.id} /></TabsContent>
          <TabsContent value="memory" className="mt-0"><MemoryTab pid={project.id} /></TabsContent>
          <TabsContent value="files" className="mt-0"><FilesTab pid={project.id} /></TabsContent>
          <TabsContent value="activity" className="mt-0"><ActivityTab pid={project.id} /></TabsContent>
        </div>
      </Tabs>}
  </div>;
}

function AddRow({ placeholder, onAdd }: { placeholder: string; onAdd: (v: string) => Promise<void> }) {
  const [v, setV] = useState(""); const [busy, setBusy] = useState(false);
  return <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (!v.trim()) return; setBusy(true); try { await onAdd(v.trim()); setV(""); } catch (err) { toast.error(err instanceof Error ? err.message : "Couldn’t save."); } finally { setBusy(false); } }}><Input value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} className="h-8 text-[13px]" /><Button size="sm" type="submit" disabled={busy || !v.trim()} aria-label="Add"><Plus /></Button></form>;
}

function TasksTab({ pid }: { pid: string }) {
  const qc = useQueryClient(); const { data = [] } = useQuery(q.tasks(pid)); const r = () => qc.invalidateQueries({ queryKey: ["tasks", pid] });
  const next = { Next: "In progress", "In progress": "Done", Done: "Next" } as Record<string, string>;
  return <div className="grid gap-3"><AddRow placeholder="Add a task" onAdd={async (t) => { await api.addTask(pid, t); r(); qc.invalidateQueries({ queryKey: ["activity", pid] }); }} />
    {data.length ? data.map((t) => <div key={t.id} className="group flex items-center gap-2 text-[13px]"><button type="button" title="Change status" onClick={async () => { await api.setTaskStatus(t.id, next[t.status] ?? "Next"); r(); }} className={cn("grid size-4 shrink-0 place-items-center rounded border", t.status === "Done" ? "border-success bg-success text-background" : t.status === "In progress" ? "border-primary" : "border-border")}>{t.status === "Done" && <Check className="size-3" />}</button><span className={cn("flex-1", t.status === "Done" && "text-muted-foreground line-through")}>{t.title}</span><span className="text-[11px] text-muted-foreground">{t.status === "In progress" ? "Doing" : ""}</span><button type="button" aria-label="Delete task" onClick={async () => { await api.deleteTask(t.id); r(); }} className="text-muted-foreground opacity-0 hover:text-danger group-hover:opacity-100"><Trash2 className="size-3.5" /></button></div>) : <p className="text-[13px] text-muted-foreground">No tasks yet.</p>}</div>;
}

function MemoryTab({ pid }: { pid: string }) {
  const qc = useQueryClient(); const { data = [] } = useQuery(q.memory(pid)); const r = () => qc.invalidateQueries({ queryKey: ["memory", pid] });
  return <div className="grid gap-3"><p className="text-[12px] text-muted-foreground">Pinned notes are shared with Exodus in this project’s chats.</p><AddRow placeholder="Remember that…" onAdd={async (t) => { await api.addMemory(pid, t); r(); }} />
    {data.length ? data.map((m) => <div key={m.id} className="group flex gap-2 rounded-md border border-border p-2.5 text-[13px] leading-6"><span className="flex-1">{m.content}</span><button type="button" aria-label={m.pinned ? "Unpin" : "Pin"} onClick={async () => { await api.toggleMemory(m.id, !m.pinned); r(); }} className={m.pinned ? "text-primary" : "text-muted-foreground"}><Pin className="size-3.5" /></button><button type="button" aria-label="Delete note" onClick={async () => { await api.deleteMemory(m.id); r(); }} className="text-muted-foreground opacity-0 hover:text-danger group-hover:opacity-100"><Trash2 className="size-3.5" /></button></div>) : <p className="text-[13px] text-muted-foreground">Nothing remembered yet.</p>}</div>;
}

function FilesTab({ pid }: { pid: string }) {
  const qc = useQueryClient(); const { data = [] } = useQuery(q.files(pid)); const [up, setUp] = useState(false);
  const upload = async (f: File | undefined) => { if (!f) return; setUp(true); try { await api.uploadFile(pid, f); toast.success(`${f.name} uploaded`); qc.invalidateQueries({ queryKey: ["files", pid] }); qc.invalidateQueries({ queryKey: ["activity", pid] }); } catch (e) { toast.error(e instanceof Error ? e.message : "Upload failed."); } finally { setUp(false); } };
  return <div className="grid gap-3"><label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-border py-3 text-[13px] text-muted-foreground hover:border-magenta-200 hover:text-foreground"><Upload className="size-4" />{up ? "Uploading…" : "Upload a file (max 10 MB)"}<input type="file" hidden disabled={up} onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} /></label>
    {data.length ? data.map((f) => <div key={f.id} className="group flex items-center gap-2 text-[13px]"><File className="size-4 text-muted-foreground" /><span className="flex-1 truncate">{f.file_name}</span><span className="text-[11px] text-muted-foreground">{Math.ceil(f.file_size / 1024)} KB</span><button type="button" aria-label="Download" onClick={async () => { const u = await api.fileUrl(f); if (u) window.open(u, "_blank"); else toast.error("Couldn’t open this file."); }} className="text-muted-foreground hover:text-foreground"><Download className="size-3.5" /></button><button type="button" aria-label="Delete file" onClick={async () => { await api.deleteFile(f); qc.invalidateQueries({ queryKey: ["files", pid] }); }} className="text-muted-foreground hover:text-danger"><Trash2 className="size-3.5" /></button></div>) : <p className="text-[13px] text-muted-foreground">No files yet.</p>}</div>;
}

function ActivityTab({ pid }: { pid: string }) {
  const { data = [] } = useQuery(q.activity(pid));
  return data.length ? <div className="grid gap-3">{data.map((a) => <div key={a.id} className="flex gap-2.5 text-[13px]"><Brain className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /><div><div>{a.title}</div><div className="text-[11px] text-muted-foreground">{new Date(a.created_at).toLocaleString()}</div></div></div>)}</div> : <p className="text-[13px] text-muted-foreground">No activity yet.</p>;
}
