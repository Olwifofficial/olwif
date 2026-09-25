import {reportTrafficLight} from "@/lib/research/traffic-light.js";
import {findReportSection,reportSectionUrl} from "@/lib/research/report-sections.js";

const OWL_SIGNS = {
 red:{image:"/o-owl-stop.png",word:"STOP",meaning:"Serious warnings — read the findings"},
 amber:{image:"/o-owl-pause.png",word:"PAUSE",meaning:"Warnings or incomplete checks — take a closer look"},
 green:{image:"/o-owl-checked.png",word:"CHECKED",meaning:"Listed checks clear — not a safety guarantee"},
};
function TeacherOwl({color}:{color:string}) {
 const sign=OWL_SIGNS[color==="red"?"red":color==="green"?"green":"amber"];
 return <div className="verdict-mascot"><img src={sign.image} width={220} height={220} alt={`O holding a ${sign.word} sign: ${sign.meaning}.`} decoding="async"/></div>;
}

export default function ReportVerdict({report,reportId}:{report:Record<string,any>;reportId?:string}) {
 const light=reportTrafficLight(report);
 const research=report.research || {};
 const title=findReportSection("summary")!.title;
 const href=reportSectionUrl(reportId,"summary");
 if(href) {
  const serious=(report.findings||[]).filter((finding:Record<string,any>)=>finding&&(finding.hardFail||finding.severity==="danger")).length;
  const warnings=(report.findings||[]).filter((finding:Record<string,any>)=>finding?.severity==="warn"&&!finding.hardFail).length;
  const headline=light.color==="red"?(serious?`${serious} serious ${serious===1?"warning":"warnings"}`:"Serious warnings found"):light.color==="amber"?(warnings?`${warnings} ${warnings===1?"warning":"warnings"} to review`:"More checks needed"):"Listed checks clear";
  return <a className={`verdict verdict--${light.color} verdict-link`} href={href} aria-label={`${title}: ${headline}. ${light.label}. View findings.`}>
   <TeacherOwl color={light.color}/>
   <div className="verdict-content"><div className="verdict-topline"><p className="eyebrow">{title}</p><span className="verdict-status">{light.label}</span></div><h2>{headline}</h2><span className="small">Research snapshot, not a safety guarantee.</span><span className="assessment-action">View findings <span aria-hidden="true">→</span></span></div>
  </a>;
 }
 return (
  <section className={`verdict verdict--${light.color}`} aria-label={`Research summary: ${light.label}`}>
   <TeacherOwl color={light.color}/>
   <div className="verdict-content">
    <div className="verdict-topline"><p className="eyebrow">{title}</p><span className="verdict-status">{light.label}</span></div>
    <h2>{research.classification || "Not enough evidence"}</h2>
    <p className="verdict-explanation">{research.mainConcern || light.reason}</p>
    <span className="small">Not an endorsement, investment recommendation or guarantee.</span>
    <details className="verdict-key">
     <summary>What the colours mean</summary>
     <ul>
      <li><strong>CHECKED · Green — listed checks clear.</strong> No warnings or gaps recorded in the checked evidence. Not an instruction to buy or a guarantee.</li>
      <li><strong>PAUSE · Yellow — take a closer look.</strong> Warnings, missing data or unverified claims need more checking.</li>
      <li><strong>STOP · Red — serious warnings.</strong> Read the warning details before going further. A warning is not, by itself, proof of fraud.</li>
     </ul>
     <p className="small">This light summarises the dated report, not the current price or a prediction of profit.</p>
    </details>
   </div>
  </section>
 );
}
