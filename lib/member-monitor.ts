import {memberDb} from "./member-store";
import {DEFAULT_MEMBER_PREFERENCES,memberPreferences,monitorSnapshot,monitorChanges} from "./member-rules.js";
import {consumeLimit,getSettings,runtime} from "./server";
import {sourceFetch} from "./source-fetch";
import {scanTarget} from "./research/analyzer.js";
import {NETWORKS,validSolanaAddress} from "./security";
const INTERVAL=15*60*1000;
type Token={token_key:string;address:string;chain:string;report_id:string;snapshot:string;last_checked_at:number;last_attempt_at:number};
export async function monitoringStatus(){
 const heartbeat=await memberDb().prepare("SELECT value FROM settings WHERE key='monitor-heartbeat'").first<{value:string}>();const lastRun=Number(heartbeat?.value)||0;
 const active=runtime("OLWIF_BACKGROUND_MONITORING")==="true"&&lastRun>Date.now()-35*60000;
 return {active,lastRun:lastRun||null,message:active?"Background checks are running in a limited shared queue. Timing depends on usage; this is not live streaming.":"Background monitoring is not running here yet. Check your watchlist on demand; hosted scheduling must be enabled before checks run while you are away."};
}
export async function runMemberMonitor({memberId,signal,scheduled=false}:{memberId?:string;signal?:AbortSignal;scheduled?:boolean}={}){
 const db=memberDb(),settings=await getSettings();if(!settings.enabled)return {checked:0,message:"Checks are paused by the owner."};
 if(scheduled&&runtime("OLWIF_BACKGROUND_MONITORING")!=="true")return {checked:0,message:"Background monitoring is disabled."};
 if(scheduled)await db.prepare("INSERT INTO settings(key,value) VALUES('monitor-heartbeat',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(String(Date.now())).run();
 const now=Date.now();
 const clause=memberId?" AND w.member_id=?":"";
 const token=await db.prepare(`SELECT t.* FROM monitor_tokens t WHERE t.lease_until<? AND t.last_attempt_at<? AND t.last_checked_at<? AND EXISTS(SELECT 1 FROM member_watches w JOIN reports r ON r.id=w.report_id JOIN members m ON m.id=w.member_id WHERE w.token_key=t.token_key AND w.monitor_enabled=1 AND r.hidden=0${clause}) ORDER BY t.last_checked_at ASC LIMIT 1`).bind(now,now-60000,now-INTERVAL,...(memberId?[memberId]:[])).first<Token>();
 if(!token)return {checked:0,message:"No watched token is due yet. Checks are at least 15 minutes apart; paused tokens are skipped."};
 if(!NETWORKS.includes(token.chain as typeof NETWORKS[number])||token.chain==="auto"||(token.chain==="solana"?!validSolanaAddress(token.address):!/^0x[a-f0-9]{40}$/i.test(token.address)))return {checked:0,message:"The saved token identity could not be checked."};
 const lease=now+90000;
 const acquired=await db.prepare("UPDATE monitor_tokens SET lease_until=?,last_attempt_at=? WHERE token_key=? AND lease_until<? AND last_attempt_at<? AND last_checked_at<? RETURNING token_key").bind(lease,now,token.token_key,now,now-60000,now-INTERVAL).first();
 if(!acquired)return {checked:0,message:"A check is already running for this token."};
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),35000);const abort=()=>controller.abort();signal?.addEventListener("abort",abort,{once:true});if(signal?.aborted)controller.abort();
 try{
 if(!await consumeLimit("member-monitor-day",96,86400000)||!await consumeLimit("research-global",3,60000))return {checked:0,message:"The shared check allowance is resting. Saved reports are still available; no paid fallback is used."};
 const report=await scanTarget(token.address,{chain:token.chain,signal:controller.signal,timeoutMs:4000,fetchImpl:sourceFetch(settings,runtime("GITHUB_TOKEN"))}) as Awaited<ReturnType<typeof scanTarget>> & {research:Record<string,unknown>};
 if(controller.signal.aborted)throw new Error("Check timed out.");
 const resolved=report.target.chain+":"+(report.target.chain==="solana"?report.target.address:report.target.address.toLowerCase());if(resolved!==token.token_key)throw new Error("Mismatched identity.");
 report.target.input=report.target.address;report.generatedAt=new Date().toISOString();
 report.research.webResearch={version:1,status:"not_requested",checkedAt:null,pages:[],checks:[],summary:["This watchlist check refreshed token and market evidence. Open a full check for new public-web research."],limitations:["Public web search was not run during monitoring."]};
 const payload=JSON.stringify(report);if(payload.length>1000000)throw new Error("Oversized check.");
 const id=crypto.randomUUID(),createdAt=Date.parse(report.generatedAt),next=monitorSnapshot(report),snapshot=JSON.stringify(next);
 const name=String(report.identity.name||"Unnamed token").slice(0,120),symbol=String(report.identity.symbol||"").slice(0,30);
 const subscriptions=await db.prepare("SELECT w.member_id,w.report_id,w.baseline,m.preferences FROM member_watches w JOIN members m ON m.id=w.member_id JOIN reports r ON r.id=w.report_id WHERE w.token_key=? AND w.monitor_enabled=1 AND r.hidden=0 LIMIT 500").bind(token.token_key).all<{member_id:string;report_id:string;baseline:string;preferences:string}>();
 const recipients:{memberId:string;reportId:string;body:string|null}[]=[];
 for(const sub of subscriptions.results){
 let prefs:ReturnType<typeof memberPreferences>={...DEFAULT_MEMBER_PREFERENCES};try{prefs=memberPreferences(JSON.parse(sub.preferences));}catch{}
 let before;try{before=JSON.parse(sub.baseline);}catch{before={};}
 const changes=monitorChanges(before,next,prefs);
 recipients.push({memberId:sub.member_id,reportId:sub.report_id,body:changes.length?changes.join(" "):null});
 }
 // A bound JSON array keeps fan-out at a constant query/parameter count, even
 // for 500 subscribers. D1's Free plan cannot execute one call per subscriber.
 // The transaction rechecks pause, deletion, hidden-report and lease state.
 // Reports contain public evidence only; this private recipient list is used
 // only by the member-table statements and never enters the public payload.
 const recipientJson=JSON.stringify(recipients);
 const committed=await db.batch([
 db.prepare("INSERT INTO reports(id,token_key,address,chain,name,symbol,created_at,classification,payload,hidden) SELECT ?,?,?,?,?,?,?,?,?,0 WHERE EXISTS(SELECT 1 FROM monitor_tokens WHERE token_key=? AND lease_until=?)").bind(id,token.token_key,token.address,token.chain,name,symbol,createdAt,String(report.research.classification),payload,token.token_key,lease),
 db.prepare("INSERT INTO member_alerts(id,member_id,title,body,report_id,created_at,read) SELECT w.member_id||':'||?,w.member_id,?,json_extract(recipient.value,'$.body'),?,?,0 FROM json_each(?) AS recipient JOIN member_watches w ON w.member_id=json_extract(recipient.value,'$.memberId') AND w.token_key=? JOIN reports r ON r.id=w.report_id JOIN members m ON m.id=w.member_id WHERE w.monitor_enabled=1 AND r.hidden=0 AND w.report_id=json_extract(recipient.value,'$.reportId') AND json_extract(recipient.value,'$.body') IS NOT NULL AND EXISTS(SELECT 1 FROM monitor_tokens WHERE token_key=? AND lease_until=?) ON CONFLICT(id) DO NOTHING").bind(id,name+" · Watchlist update",id,createdAt,recipientJson,token.token_key,token.token_key,lease),
 db.prepare("UPDATE member_watches AS w SET baseline=?,report_id=? FROM json_each(?) AS recipient WHERE w.member_id=json_extract(recipient.value,'$.memberId') AND w.token_key=? AND w.report_id=json_extract(recipient.value,'$.reportId') AND w.monitor_enabled=1 AND EXISTS(SELECT 1 FROM reports r JOIN members m ON m.id=w.member_id WHERE r.id=w.report_id AND r.hidden=0) AND EXISTS(SELECT 1 FROM monitor_tokens WHERE token_key=? AND lease_until=?)").bind(snapshot,id,recipientJson,token.token_key,token.token_key,lease),
 db.prepare("UPDATE monitor_tokens SET report_id=?,snapshot=?,last_checked_at=? WHERE token_key=? AND lease_until=?").bind(id,snapshot,createdAt,token.token_key,lease),
 db.prepare("DELETE FROM member_alerts WHERE created_at<?").bind(Date.now()-30*86400000),
 ]);
 if(committed[3].meta.changes!==1)return {checked:0,message:"Another check took over this token. Your saved figures were not overwritten."};
 return {checked:1,message:`Updated ${name}. Alerts appear in your inbox when your thresholds are met. Other due tokens remain in the shared queue.`};
 }catch{return {checked:0,message:"The check did not finish. Your last successful figures are unchanged; try again shortly."};}
 finally{clearTimeout(timer);signal?.removeEventListener("abort",abort);await db.prepare("UPDATE monitor_tokens SET lease_until=0 WHERE token_key=? AND lease_until=?").bind(token.token_key,lease).run();}
}
