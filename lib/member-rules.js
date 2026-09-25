import {reportTrafficLight} from "./research/traffic-light.js";
export const DEFAULT_MEMBER_PREFERENCES=Object.freeze({alertsEnabled:true,priceChangePct:10,liquidityDropPct:20,riskChanges:true,quietStart:"",quietEnd:""});
export const REPORT_ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function memberPreferences(value){
 if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Invalid alert settings.");
 const {alertsEnabled,priceChangePct,liquidityDropPct,riskChanges,quietStart,quietEnd}=value;
 if(typeof alertsEnabled!=="boolean"||typeof riskChanges!=="boolean"||typeof priceChangePct!=="number"||!Number.isFinite(priceChangePct)||priceChangePct<1||priceChangePct>1000||typeof liquidityDropPct!=="number"||!Number.isFinite(liquidityDropPct)||liquidityDropPct<1||liquidityDropPct>100)throw new Error("Choose a valid alert threshold.");
 const time=v=>typeof v==="string"&&(v===""||/^([01]\d|2[0-3]):[0-5]\d$/.test(v));
 if(!time(quietStart)||!time(quietEnd)||Boolean(quietStart)!==Boolean(quietEnd)||(quietStart&&quietStart===quietEnd))throw new Error("Choose different start and end times, or leave both empty. Times are UTC.");
 return {alertsEnabled,priceChangePct,liquidityDropPct,riskChanges,quietStart,quietEnd};
}
export function positionNumber(value){if(value===null||value==="")return null;if(typeof value!=="number"||!Number.isFinite(value)||value<0||value>1e15)throw new Error("Enter a non-negative amount, or leave it empty.");return value;}
const finite=value=>typeof value==="number"&&Number.isFinite(value)&&value>=0?value:null;
export function monitorSnapshot(report){
 const m=report?.metrics||{},sources=Array.isArray(report?.sources)?report.sources:[];
 const market=sources.some(s=>s?.ok===true&&["DEX market","GeckoTerminal market"].includes(s.name));
 const warnings=(Array.isArray(report?.findings)?report.findings:[]).filter(f=>f&&(f.hardFail||["warn","danger"].includes(f.severity))).map(f=>String(f.code||f.title||"Warning")).sort();
 return {priceUsd:market?finite(m.priceUsd):null,liquidityUsd:market?finite(m.liquidityUsd):null,poolAddress:typeof report?.research?.market?.pairAddress==="string"?report.research.market.pairAddress:null,light:reportTrafficLight(report).color,warnings:[...new Set(warnings)],checkedAt:report?.generatedAt||null};
}
export function isQuietTime(prefs,now=Date.now()){
 if(!prefs.quietStart||!prefs.quietEnd)return false;const d=new Date(now),minute=d.getUTCHours()*60+d.getUTCMinutes();
 const toMinutes=t=>Number(t.slice(0,2))*60+Number(t.slice(3));const start=toMinutes(prefs.quietStart),end=toMinutes(prefs.quietEnd);
 return start<end?minute>=start&&minute<end:minute>=start||minute<end;
}
export function monitorChanges(before,after,prefs=memberPreferences(DEFAULT_MEMBER_PREFERENCES)){
 if(!prefs.alertsEnabled)return [];
 const changes=[];const samePool=typeof before?.poolAddress==="string"&&before.poolAddress.trim().length>0&&before.poolAddress===after?.poolAddress;
 if(samePool&&finite(before?.priceUsd)>0&&finite(after?.priceUsd)!==null){const delta=((after.priceUsd-before.priceUsd)/before.priceUsd)*100;if(Number.isFinite(delta)&&Math.abs(delta)+1e-10>=prefs.priceChangePct)changes.push(`Price ${delta>=0?"up":"down"} ${Math.abs(delta).toFixed(1)}% since the previous saved check.`);}
 if(samePool&&finite(before?.liquidityUsd)>0&&finite(after?.liquidityUsd)!==null){const drop=((before.liquidityUsd-after.liquidityUsd)/before.liquidityUsd)*100;if(drop+1e-10>=prefs.liquidityDropPct)changes.push(`Selected-pool liquidity down ${drop.toFixed(1)}% since the previous saved check.`);}
 if(prefs.riskChanges){const old=new Set(before?.warnings||[]),added=(after?.warnings||[]).filter(code=>!old.has(code));if(added.length)changes.push(`${added.length} new warning${added.length===1?"":"s"} in the latest check. Open the findings for the evidence.`);if(before?.light&&after?.light&&before.light!==after.light)changes.push(`Overall signal changed from ${before.light==="amber"?"yellow":before.light} to ${after.light==="amber"?"yellow":after.light}.`);}
 return changes;
}
