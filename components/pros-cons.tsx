import {reportProsCons} from "@/lib/research/pros-cons.js";
import {reportSectionUrl} from "@/lib/research/report-sections.js";

type Point={text:string;severity?:string;hardFail?:boolean};
type Item=Record<string,any>;
const serious=(point:Point)=>point.hardFail||point.severity==="danger";

export default function ProsCons({report,reportId,detailed=false}:{report:Item;reportId:string;detailed?:boolean}) {
 const {pros,cons}=reportProsCons(report) as {pros:Point[];cons:Point[]};
 const priority=cons.filter(serious);
 const shownCons=detailed?cons:[...priority,...cons.filter(point=>!serious(point)).slice(0,Math.max(0,4-priority.length))];
 const route=reportSectionUrl(reportId,"summary");
 const href=detailed?"#finding-details":route?`${route}#all-findings`:null;
 const groups=[
  {key:"pros",title:"Pros",symbol:"+",all:pros,shown:detailed?pros:pros.slice(0,4),empty:"No supported pros recorded."},
  {key:"cons",title:"Cons",symbol:"−",all:cons,shown:shownCons,empty:"No cons recorded in the returned checks."},
 ];
 return <div className="pros-cons">
  <div className="two-column">{groups.map(group=><section className={`panel pros-cons-panel pros-cons-panel--${group.key}`} key={group.key} aria-label={group.title}>
   <h2><span className="pros-cons-symbol" aria-hidden="true">{group.symbol}</span>{group.title}</h2>
   {group.shown.length?<ul className="pros-cons-list">{group.shown.map((point,index)=><li key={index}>{point.text}</li>)}</ul>:<p className="pros-cons-empty">{group.empty}</p>}
   {group.all.length>group.shown.length&&<span className="pros-cons-more">{group.all.length-group.shown.length} more in the full findings</span>}
  </section>)}</div>
  <div className="pros-cons-footer"><span>Recorded checks, not a safety guarantee.</span>{href&&<a href={href}>Full findings <span aria-hidden="true">→</span></a>}</div>
 </div>;
}
