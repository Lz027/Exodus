import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceShell } from "@/components/exodus/workspace-shell";
export const Route=createFileRoute("/chat/$threadId")({head:()=>({meta:[{title:"Conversation — Exodus"},{name:"description",content:"A focused conversation in the Exodus private workspace."},{property:"og:title",content:"Conversation — Exodus"},{property:"og:description",content:"A focused conversation in the Exodus private workspace."},{property:"og:type",content:"website"},{name:"twitter:card",content:"summary_large_image"}]}),component:Page});
function Page(){const {threadId}=Route.useParams();return <WorkspaceShell page={{kind:"chat",threadId}}/>}
