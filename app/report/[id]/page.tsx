import {getDb} from "@/db";import {reports} from "@/db/schema";import {eq,and} from "drizzle-orm";import {notFound} from "next/navigation";import ReportView from "@/app/report-view";
export const dynamic="force-dynamic";
export default async function Report({params}:{params:Promise<{id:string}>}){
 const {id}=await params;const rows=await getDb().select({payload:reports.payload}).from(reports).where(and(eq(reports.id,id),eq(reports.hidden,false))).limit(1);if(!rows[0])notFound();
 return <ReportView report={JSON.parse(rows[0].payload)} id={id}/>;
}
