import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight, LockKeyhole } from "lucide-react";
import logo from "@/assets/exodus-logo.png.asset.json";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isDemoSignedIn, setDemoSignedIn } from "@/lib/exodus-store";

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
  const navigate = useNavigate({ from: "/" });
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (isDemoSignedIn()) navigate({ to: "/chat/$threadId", params: { threadId: "shape-exodus" }, replace: true });
  }, [navigate]);
  const enter = () => {
    setLoading(true);
    setTimeout(() => {
      setDemoSignedIn(true);
      navigate({ to: "/chat/$threadId", params: { threadId: "shape-exodus" } });
    }, 650);
  };
  return (
    <div className="relative grid min-h-dvh place-items-center overflow-hidden bg-background px-5 py-10">
      <div className="dream-wash" aria-hidden="true" />
      <main className="relative z-10 w-full max-w-sm">
        <div className="mb-10 text-center">
          <img src={logo.url} alt="Exodus" className="mx-auto size-24 object-contain" />
          <h1 className="mt-5 font-display text-4xl font-semibold">Exodus</h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">A private place to think, shape, and build.</p>
        </div>
        <div className="rounded-xl border border-border bg-popover/90 p-6 shadow-panel backdrop-blur">
          <div className="mb-5 flex items-center gap-2 text-sm font-medium"><LockKeyhole className="size-4 text-primary" />Welcome back</div>
          <label className="grid gap-1.5 text-sm font-medium">Email<Input value="ahmed@exodus.local" readOnly aria-label="Demo email" /></label>
          <label className="mt-4 grid gap-1.5 text-sm font-medium">Password<Input type="password" value="exodus-demo" readOnly aria-label="Demo password" /></label>
          <Button className="mt-5 w-full" size="lg" onClick={enter} disabled={loading}>{loading ? "Opening workspace…" : "Enter workspace"}<ArrowRight /></Button>
          <p className="mt-4 text-center text-[11px] leading-5 text-muted-foreground">Simulated sign-in for this local prototype. No account or password is stored.</p>
        </div>
      </main>
    </div>
  );
}
