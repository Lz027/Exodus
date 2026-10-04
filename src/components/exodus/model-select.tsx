import { Check, ChevronDown, Eye, Mic, Volume2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { chatProfileOrder, profiles, type Availability, type ModelState, type ProfileKey } from "@/lib/ai/registry";
import { cn } from "@/lib/utils";

const dot = (s: ModelState | undefined) => cn("size-1.5 shrink-0 rounded-full", s === "available" ? "bg-success" : s === "unavailable" ? "bg-danger" : "bg-muted-foreground/40");
const stateLabel = (s: ModelState | undefined) => (s === "available" ? "Available" : s === "unavailable" ? "Unavailable" : "Checking");

export function ModelSelect({ value, onChange, availability }: { value: ProfileKey; onChange: (k: ProfileKey) => void; availability?: Availability }) {
  const current = profiles[value];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="press inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring" aria-label={`Model: ${current.label}`}>
        <span className={dot(availability?.[value])} />{current.label}<ChevronDown className="size-3.5 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">Chat</DropdownMenuLabel>
        {chatProfileOrder.map((k) => <Item key={k} k={k} active={value === k} state={availability?.[k]} onSelect={() => onChange(k)} />)}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">Vision</DropdownMenuLabel>
        <div className="flex items-start gap-2.5 px-2 py-1.5 text-[13px]"><Eye className="mt-0.5 size-4 text-muted-foreground" /><div className="min-w-0 flex-1"><div className="flex items-center gap-2 font-medium">Vision<span className={dot(availability?.vision)} /></div><div className="text-xs text-muted-foreground">Used automatically when you attach an image · {stateLabel(availability?.vision)}</div></div></div>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">Voice</DropdownMenuLabel>
        <div className="flex items-start gap-2.5 px-2 py-1.5 text-[13px]"><Mic className="mt-0.5 size-4 text-muted-foreground" /><div className="flex-1"><div className="flex items-center gap-2 font-medium">Voice<span className={dot(availability?.voice)} /></div><div className="text-xs text-muted-foreground">Microphone transcription · {stateLabel(availability?.voice)}</div></div></div>
        <div className="flex items-start gap-2.5 px-2 py-1.5 text-[13px]"><Volume2 className="mt-0.5 size-4 text-muted-foreground" /><div className="flex-1"><div className="flex items-center gap-2 font-medium">Speak<span className={dot(availability?.speak)} /></div><div className="text-xs text-muted-foreground">Read replies aloud · {stateLabel(availability?.speak)}</div></div></div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Item({ k, active, state, onSelect }: { k: ProfileKey; active: boolean; state: ModelState | undefined; onSelect: () => void }) {
  const p = profiles[k];
  return (
    <DropdownMenuItem disabled={state === "unavailable"} onSelect={onSelect} className={cn("items-start gap-2.5 py-1.5", active && "bg-magenta-50")}>
      <span className={cn(dot(state), "mt-1.5")} />
      <div className="min-w-0 flex-1"><div className={cn("text-[13px] font-medium", active && "text-primary-strong")}>{p.label}</div><div className="text-xs text-muted-foreground">{state === "unavailable" ? "Unavailable on your Groq account right now" : p.description}</div></div>
      {active && <Check className="mt-0.5 size-4 text-primary" />}
    </DropdownMenuItem>
  );
}
