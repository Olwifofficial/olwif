import {getDb} from "@/db";
import {reports} from "@/db/schema";
import {eq,and} from "drizzle-orm";
import {notFound} from "next/navigation";
import ReportDetailPage from "@/components/report-detail-page";
import {findReportSection} from "@/lib/research/report-sections.js";

export const dynamic="force-dynamic";
export default async function Page({params}:{params:Promise<{id:string;section:string}>}) {
 const {id,section}=await params;
 if(!findReportSection(section))notFound();
 const rows=await getDb().select({payload:reports.payload}).from(reports).where(and(eq(reports.id,id),eq(reports.hidden,false))).limit(1);
 if(!rows[0])notFound();
 return <ReportDetailPage report={JSON.parse(rows[0].payload)} id={id} section={section}/>;
}
