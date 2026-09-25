import {scanTarget,parseTarget} from "@/lib/research/analyzer.js";
import {getDb} from "@/db";import {reports} from "@/db/schema";
import {NETWORKS,assertSameOrigin,readJson,validSolanaAddress} from "@/lib/security";
import {sourceFetch} from "@/lib/source-fetch";
import {collectPublicWeb} from "@/lib/research/public-web.js";
import {runtime,json,getSettings,recentReport,consumeLimit,cleanLimits,reserveFreeSearch} from "@/lib/server";
export const dynamic="force-dynamic";
export async function POST(request:Request){
 let input:string,chain:string,target:NonNullable<ReturnType<typeof parseTarget>>;
 try{
 assertSameOrigin(request,runtime("SITE_ORIGIN"));const body=await readJson(request);
 if(typeof body.query!=="string"||body.query.length>2048)throw new Error("Paste an exact token address or token link.");
 input=body.query.trim();chain=typeof body.chain==="string"?body.chain:"auto";
 if(!NETWORKS.includes(chain as typeof NETWORKS[number]))throw new Error("Choose a supported network.");
 const parsed=parseTarget(input);if(!parsed||(parsed.chain==="solana"&&!validSolanaAddress(parsed.address)))throw new Error("That is not a valid token address. Paste the complete mint or contract.");
 if(chain!=="auto"&&parsed.chain!=="auto"&&chain!==parsed.chain)throw new Error("The address or explorer link does not match the selected network.");
 if(chain==="solana"&&parsed.address.startsWith("0x"))throw new Error("A 0x address is not a Solana mint.");
 target=parsed;
 }catch(e){return json({error:(e as Error).message},400);}
 try{
 const settings=await getSettings();if(!settings.enabled)return json({error:"Checks are paused by the owner. Saved reports are still available."},503);
 const resolved=chain==="auto"?target.chain:chain;
 const key=resolved+":"+(target.address.startsWith("0x")?target.address.toLowerCase():target.address);
 const cached=await recentReport(key);if(cached)return json({id:cached.id,cached:true,generatedAt:new Date(cached.createdAt).toISOString()});
 if(!await consumeLimit("research-global",3,60000))return json({error:"O is checking a few projects. Please try again in one minute; this protects the public data sources."},429);
 await cleanLimits();
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),45000);
 const cancel=()=>controller.abort();request.signal.addEventListener("abort",cancel,{once:true});
 let report:any;
 try{
  report=await scanTarget(input,{chain,signal:controller.signal,timeoutMs:4000,fetchImpl:sourceFetch(settings,runtime("GITHUB_TOKEN"))});
  const webController=new AbortController();const webTimer=setTimeout(()=>webController.abort(),26000);
  const cancelWeb=()=>webController.abort();controller.signal.addEventListener("abort",cancelWeb,{once:true});
  try{
   if(controller.signal.aborted)webController.abort();
   report.research.webResearch=await collectPublicWeb(report,{signal:webController.signal,timeoutMs:8000,tavilyKey:runtime("TAVILY_API_KEY"),freeOnlyKeySha256:runtime("TAVILY_FREE_ONLY_KEY_SHA256"),disabledSources:settings.disabledSources,reserveSearch:reserveFreeSearch});
   if(controller.signal.aborted)throw new Error("The check was cancelled.");
  }catch{
   if(controller.signal.aborted)throw new Error("The check was cancelled.");
   report.research.webResearch={version:1,mode:"free-only",status:"unavailable",checkedAt:new Date().toISOString(),search:{status:"error",message:"Public web research did not finish within its time limit."},pages:[],checks:[],summary:["Public web research did not finish. The other source checks remain available."],limitations:["No conclusions about page content or social activity were made. No paid fallback was used."]};
  }finally{clearTimeout(webTimer);controller.signal.removeEventListener("abort",cancelWeb);}
  report.generatedAt=new Date().toISOString();report.research.freshness.fetchedAt=report.generatedAt;
 }
 catch(e){const message=(e as Error).message;return json({error:/network|supported|conflicts|0x|address/i.test(message)?message:"The check could not finish. Please try again shortly."},controller.signal.aborted?504:422);}
 finally{clearTimeout(timer);request.signal.removeEventListener("abort",cancel);}
 if(!NETWORKS.includes(report.target.chain as typeof NETWORKS[number]))return json({error:"Please select a supported network."},400);
 // Store evidence snapshots, never secrets or the pasted URL (which may have tracking parameters).
 report.target.input=report.target.address;
 const id=crypto.randomUUID();const tokenKey=report.target.chain+":"+(report.target.chain==="solana"?report.target.address:report.target.address.toLowerCase());
 const payload=JSON.stringify(report);if(payload.length>1000000)return json({error:"This report was too large to save safely."},502);
 await getDb().insert(reports).values({id,tokenKey,address:report.target.address,chain:report.target.chain,name:String(report.identity.name||"Unnamed token").slice(0,120),symbol:String(report.identity.symbol||"").slice(0,30),createdAt:Date.parse(report.generatedAt),classification:report.research.classification,payload});
 return json({id,cached:false,generatedAt:report.generatedAt});
 }catch{console.error("Research storage or configuration unavailable.");return json({error:"The research service is temporarily unavailable. Please try again later."},503);}
}
