import {reportTrafficLight,assessmentTrafficLight} from "./traffic-light.js";
import {marketSnapshot} from "./market-snapshot.js";
const CATEGORIES=["Identity","Integrity","Substance","Momentum","Flow quality"];
// The sixth light is the overall verdict, not another independent audit.
// The same evidence rules apply to every address and project, including OLWIF.
export function celebrationEligible(report,now=Date.now()){
 if(!report||!Number.isFinite(now))return false;
 const checked=Date.parse(report.generatedAt);
 if(!Number.isFinite(checked)||checked>now+60000||now-checked>15*60000)return false;
 const assessments=report.research?.assessments;
 if(!Array.isArray(assessments)||assessments.length!==CATEGORIES.length)return false;
 if(reportTrafficLight(report).color!=="green")return false;
 return CATEGORIES.every(name=>{const matches=assessments.filter(a=>a?.name===name);if(matches.length!==1)return false;
  // Match the displayed price card, which follows observed price windows,
  // not the legacy momentum score. Overall green already excludes warnings.
  return name==="Momentum"?marketSnapshot(report).trend.tone==="up":assessmentTrafficLight(matches[0],report).color==="green";
 });
}
