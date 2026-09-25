import ResearchDesk from "./research-desk";import {getSettings} from "@/lib/server";
export const dynamic="force-dynamic";
export default async function Page(){let notice="";try{const settings=await getSettings();notice=!settings.enabled?"New checks are paused. You can still browse saved reports.":settings.notice;}catch{notice="The report store is starting up. Please try a check shortly.";}return <ResearchDesk notice={notice}/>;}
