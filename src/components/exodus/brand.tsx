import logo from "@/assets/exodus-logo.png.asset.json";
import { cn } from "@/lib/utils";
export function ExodusBrand({compact=false,className}:{compact?:boolean;className?:string}){return <div className={cn("flex min-w-0 items-center gap-2.5",className)}><img src={logo.url} alt="Exodus" className="size-8 shrink-0 object-contain"/><div className={cn("min-w-0",compact&&"sr-only")}><div className="truncate font-display text-[15px] font-semibold text-foreground">Exodus</div><div className="truncate text-[10px] text-muted-foreground">Private workspace</div></div></div>}
