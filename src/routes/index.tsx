import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import logo from "@/assets/exodus-logo.png.asset.json";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/lib/exodus-api";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Exodus — Private AI workspace" },
      { name: "description", content: "A calm private workspace for thinking, building, and shaping digital products." },
      { property: "og:title", content: "Exodus — Private AI workspace" },
      { property: "og:description", content: "A calm private workspace for thinking, building, and shaping digital products." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const navigate = useNavigate();
  const { session, ready } = useSession();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (ready && session) navigate({ to: "/chat/$threadId", params: { threadId: "new" }, replace: true }); }, [ready, session, navigate]);

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError("");
    try {
      if (mode === "in") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin, data: { display_name: name } } });
        if (error) throw error;
        if (!data.session) { toast.success("Check your inbox to confirm your email, then sign in."); setMode("in"); }
      }
    } catch (err) {
      setError(err instanceof Error ? (/invalid login/i.test(err.message) ? "That email and password don’t match." : err.message) : "Something went wrong.");
    } finally { setBusy(false); }
  };

  return (
    <div className="relative grid min-h-dvh place-items-center bg-background px-5 py-10">
      <div className="dream-wash" aria-hidden="true" />
      <main className="relative z-10 w-full max-w-[22rem]">
        <div className="mb-8 text-center">
          <img src={logo.url} alt="" className="mx-auto size-14 object-contain" />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">{mode === "in" ? "Welcome back to Exodus" : "Create your Exodus space"}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">A private place to think, shape, and build.</p>
        </div>
        <form onSubmit={submit} className="grid gap-3.5 rounded-xl border border-border bg-surface p-6 shadow-soft">
          {mode === "up" && <label className="grid gap-1.5 text-[13px] font-medium">Your name<Input value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" /></label>}
          <label className="grid gap-1.5 text-[13px] font-medium">Email<Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" /></label>
          <label className="grid gap-1.5 text-[13px] font-medium">Password<Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} autoComplete={mode === "in" ? "current-password" : "new-password"} /></label>
          {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
          <Button type="submit" className="press mt-1 w-full" disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : null}{mode === "in" ? "Sign in" : "Create account"}{!busy && <ArrowRight />}</Button>
        </form>
        <p className="mt-5 text-center text-[13px] text-muted-foreground">
          {mode === "in" ? "New to Exodus?" : "Already have an account?"}{" "}
          <button type="button" className="font-medium text-primary hover:underline" onClick={() => { setMode(mode === "in" ? "up" : "in"); setError(""); }}>{mode === "in" ? "Create an account" : "Sign in"}</button>
        </p>
      </main>
    </div>
  );
}
