import {assessmentTrafficLight} from "@/lib/research/traffic-light.js";
import {projectEvidence} from "@/lib/research/project-evidence.js";
import {tradingActivity} from "@/lib/research/assessment-details.js";
import {marketSnapshot} from "@/lib/research/market-snapshot.js";
import {findReportSection,sectionForAssessment,reportSectionUrl} from "@/lib/research/report-sections.js";

type Assessment = {name:string; status:string; summary:string};
type Item = Record<string,any>;
const CATEGORIES: Record<string,string[]> = {Identity:["Identity"],Integrity:["Authority","On-chain risk","Sellability","Contract","Liquidity","Distribution"],Substance:["Authenticity","Creator"],Momentum:["Market"],"Flow quality":["Distribution"]};
const count=(value:number)=>value.toLocaleString("en-GB");
const cash=(value:number|null,compact=false)=>value===null?"Not available":new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",...(compact?{notation:"compact",maximumFractionDigits:2}:{maximumSignificantDigits:6,minimumFractionDigits:2})}).format(value);
const change=(value:number)=>`${value>0?"+":""}${value.toLocaleString("en-GB",{maximumFractionDigits:2})}%`;
const countValue=(value:number|null|undefined)=>value==null?"Not available":count(value);

export default function AssessmentCard({assessment,report,reportId}:{assessment:Assessment;report:Record<string,any>;reportId?:string}) {
 // Display recorded observations without changing saved risk scores or evidence.
 let light=assessmentTrafficLight(assessment,report);
 const isProject=assessment.name==="Substance",isActivity=assessment.name==="Flow quality",isMarket=assessment.name==="Momentum";
 const market=isMarket?marketSnapshot(report):null;
 const evidence=isProject?projectEvidence(report):null;
 const activity=isActivity?tradingActivity(report):null,window=activity?.selected;
 const findings=(Array.isArray(report.findings)?report.findings:[]).filter((finding:Item)=>finding&&(CATEGORIES[assessment.name]?.includes(finding.category)||(isActivity&&finding.code==="NO_SELL_FLOW")));
 const serious=findings.filter((finding:Item)=>finding.hardFail||finding.severity==="danger").length;
 const warnings=findings.filter((finding:Item)=>finding.hardFail||["danger","warn"].includes(finding.severity));
 const firstWarning=[...warnings].sort((a:Item,b:Item)=>Number(!!(b.hardFail||b.severity==="danger"))-Number(!!(a.hardFail||a.severity==="danger")))[0];
 if(isMarket) {
  // The price card's colour follows observed direction, never an old flow score.
  const color=serious?"red":findings.some((finding:Item)=>!["good","info"].includes(finding.severity))?"amber":market?.trend.tone==="up"?"green":market?.trend.tone==="down"?"red":"amber";
  light={color,label:color==="amber"?"YELLOW":color.toUpperCase()};
 }
 const section=sectionForAssessment(assessment.name);
 const title=findReportSection(section)?.title||assessment.name;
 const baseStatus=isProject?(evidence?.links.length?`${evidence.links.length} project link${evidence.links.length===1?"":"s"} found`:"No project links found"):
  isActivity?(window?`${window.window} ${activity?.complete?"activity snapshot":"activity · partial data"}`:"Activity data unavailable"):isMarket?market!.trend.label:assessment.status;
 const status=serious?`${serious} serious warning${serious===1?"":"s"}`:baseStatus;
 const preview=isProject?(serious?baseStatus:evidence?.pagesRead?`${evidence.pagesRead} public page${evidence.pagesRead===1?"":"s"} read · ownership not verified`:"Page content not checked."):
  assessment.name==="Integrity"?(findings.length?`${findings.length} recorded check${findings.length===1?"":"s"} to explore.`:"No token-control evidence returned."):
  assessment.name==="Identity"?(light.color==="green"?"Matched to the exact token address.":"Chain and token-address evidence."):"Open the recorded findings.";
 const href=section?reportSectionUrl(reportId,section):null;
 const Card=href?"a":"article";
 const accessible=isMarket?`${title}: market cap ${cash(market!.marketCapUsd)}, price ${cash(market!.priceUsd)} USD; ${baseStatus}${serious?`; ${status}`:""}`:isActivity?`${title}: ${baseStatus}; buys ${countValue(window?.buys)}, sells ${countValue(window?.sells)}${warnings.length?`; ${serious?status:`${warnings.length} warning${warnings.length===1?"":"s"}`}`:""}`:`${title}: ${status}`;
 return (
  <Card className={`assessment assessment--${light.color}${href?" assessment-link":""}`} {...(href?{href}:{})} aria-label={`${accessible}. ${light.label}.${href?" View findings.":""}`}>
   <header className="assessment-heading">
    <h3>{title}</h3>
    <div className="assessment-lights" aria-hidden="true">
     {["red","amber","green"].map(color=><span key={color} className={`traffic-lamp traffic-lamp--${color}${light.color===color?" is-active":""}`}>{light.color===color?(color==="green"?"✓":"!"):null}</span>)}
    </div>
   </header>
   {isMarket&&market?<>
    <div className="market-cap"><span className="market-metric-label">MC · Market cap · USD</span><strong className="market-cap-value" title={cash(market.marketCapUsd)}>{cash(market.marketCapUsd,true)}</strong><span className="market-token-price">Price <strong>{cash(market.priceUsd)}</strong> <span>USD per token</span></span></div>
    <div className={`market-trend market-trend--${market.trend.tone}`}><span className="assessment-colour">{light.label}</span><strong className="market-trend-label">{market.trend.label}</strong></div>
    <div className="market-change-list" aria-label="Recorded price changes">{market.trend.windows.map((entry:Item)=><span key={entry.window}>{entry.window} <strong>{change(entry.priceChangePct)}</strong></span>)}</div>
    {firstWarning&&<div className="assessment-alert"><strong>{serious?status:`${warnings.length} warning${warnings.length===1?"":"s"}`}</strong><span>{firstWarning.title||"Market data needs review."}</span></div>}
    <p className="assessment-preview market-snapshot-note">Saved snapshot · market direction, not a forecast.</p>
   </>:isActivity?<>
    <div className="activity-topline"><span className="assessment-window">{baseStatus}</span><span className="assessment-colour">{light.label}</span></div>
    <dl className="assessment-counts"><div><dt>Buys</dt><dd>{countValue(window?.buys)}</dd></div><div><dt>Sells</dt><dd>{countValue(window?.sells)}</dd></div></dl>
    {firstWarning?<div className="assessment-alert"><strong>{serious?status:`${warnings.length} warning${warnings.length===1?"":"s"}`}</strong><span>{firstWarning.title||"Trading activity needs review."}</span></div>:<p className="assessment-preview">{window?"Recorded trades, not unique people.":"No usable market snapshot returned."}</p>}
    {window&&window.buys===null&&window.sells===null&&<span className="activity-partial">{window.transactions!==null?`${count(window.transactions)} transactions`:window.volumeUsd!==null?`${cash(window.volumeUsd)} volume`:""} · buy/sell split unavailable</span>}
   </>:<><div className="assessment-result"><span className="assessment-colour">{light.label}</span><strong className="assessment-status">{status}</strong></div><p className="assessment-preview">{preview}</p></>}
   {href&&<span className="assessment-action">View findings <span aria-hidden="true">→</span></span>}
  </Card>
 );
}
