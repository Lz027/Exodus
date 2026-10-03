import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceShell } from "@/components/exodus/workspace-shell";
export const Route=createFileRoute("/project/$projectId")({head:()=>({meta:[{title:"Project — Exodus"},{name:"description",content:"Project context, tasks, files, and decisions in Exodus."},{property:"og:title",content:"Project — Exodus"},{property:"og:description",content:"Project context, tasks, files, and decisions in Exodus."},{property:"og:type",content:"website"},{name:"twitter:card",content:"summary_large_image"}]}),component:Page});
function Page(){const {projectId}=Route.useParams();return <WorkspaceShell page={{kind:"project",projectId}}/>}
