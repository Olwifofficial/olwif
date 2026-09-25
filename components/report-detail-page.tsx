import SiteShell from "@/app/site-shell";
import ReportDetail from "@/components/report-detail";
import {REPORT_SECTIONS,findReportSection,reportSectionUrl} from "@/lib/research/report-sections.js";
import {ArrowLeft} from "lucide-react";

type Item=Record<string,any>;
export default function ReportDetailPage({report,id,section}:{report:Item;id:string;section:string}) {
 const current=findReportSection(section);
 if(!current)return null;
 const timestamp=Date.parse(report.generatedAt);
 const date=Number.isFinite(timestamp)?new Date(timestamp).toISOString().replace("T"," ").slice(0,19)+" UTC":"Time not recorded";
 const credit=(report.sources||[]).some((source:Item)=>source?.ok===true&&["GeckoTerminal market","GeckoTerminal metadata"].includes(source.name))||report.research?.market?.provider==="GeckoTerminal"||report.research?.market?.corroboration?.provider==="GeckoTerminal";
 return <SiteShell><main className="page-wrap report-detail-page">
  <a className="back-link" href={`/report/${encodeURIComponent(id)}#report-summary`}><ArrowLeft size={16}/>Back to report</a>
  <header className="report-detail-heading"><div><p className="eyebrow">{report.identity?.name||"Unnamed token"} · {report.identity?.chain||report.target?.chain||"Network not recorded"}</p><h1 className="page-title">{current.title}</h1><p>{current.description}</p><p className="small muted">Saved check · {date}</p></div><img className="report-owl" src="/o-owl.png" alt="" width={92} height={96}/></header>
  <div className="address-strip"><code>{report.target?.address||"Address not recorded"}</code></div>
  <nav className="report-detail-nav" aria-label="Research detail sections">{REPORT_SECTIONS.map(item=><a key={item.slug} href={reportSectionUrl(id,item.slug)!} aria-current={item.slug===section?"page":undefined}>{item.title}</a>)}</nav>
  <ReportDetail report={report} id={id} section={section}/>
  {credit&&<p className="small muted">On-chain data · <a className="inline-link" href="https://www.coingecko.com/en/api" target="_blank" rel="noopener noreferrer">Powered by CoinGecko</a></p>}
  <a className="back-link detail-bottom-back" href={`/report/${encodeURIComponent(id)}#report-summary`}><ArrowLeft size={16}/>Back to report</a>
 </main></SiteShell>;
}
