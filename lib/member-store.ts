import {env} from "cloudflare:workers";
import {DEFAULT_MEMBER_PREFERENCES,memberPreferences,positionNumber,REPORT_ID,monitorSnapshot} from "./member-rules.js";
import {NETWORKS,validSolanaAddress} from "./security";
export type MemberIdentity={id:string;walletAddress:string};
export const memberDb=()=>env.DB as D1Database;
const parse=(value:string)=>{try{return JSON.parse(value);}catch{return null;}};
export async function ensureMember(db:D1Database,id:string){await db.prepare("INSERT INTO members(id,preferences,created_at) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING").bind(id,JSON.stringify(DEFAULT_MEMBER_PREFERENCES),Date.now()).run();}
export async function getMemberState(db:D1Database,user:MemberIdentity){
 const member=await db.prepare("SELECT preferences FROM members WHERE id=?").bind(user.id).first<{preferences:string}>();
 const saved=await db.prepare("SELECT r.id,r.name,r.symbol,r.chain,r.address,r.created_at AS createdAt FROM saved_reports s JOIN reports r ON r.id=s.report_id WHERE s.member_id=? AND r.hidden=0 ORDER BY s.created_at DESC LIMIT 100").bind(user.id).all();
 const watches=await db.prepare("SELECT w.token_key AS tokenKey,w.report_id AS reportId,w.quantity,w.cost_basis_usd AS costBasisUsd,w.monitor_enabled AS monitorEnabled,r.name,r.symbol,r.chain,r.address,t.snapshot,t.last_checked_at AS lastCheckedAt,t.last_attempt_at AS lastAttemptAt FROM member_watches w JOIN reports r ON r.id=w.report_id LEFT JOIN monitor_tokens t ON t.token_key=w.token_key WHERE w.member_id=? AND r.hidden=0 ORDER BY w.created_at DESC LIMIT 20").bind(user.id).all();
 const alerts=await db.prepare("SELECT a.id,a.title,a.body,a.created_at AS createdAt,a.read,a.report_id AS reportId FROM member_alerts a JOIN reports r ON r.id=a.report_id WHERE a.member_id=? AND r.hidden=0 ORDER BY a.created_at DESC LIMIT 100").bind(user.id).all();
 let preferences:ReturnType<typeof memberPreferences>={...DEFAULT_MEMBER_PREFERENCES};try{preferences=memberPreferences(parse(member?.preferences||""));}catch{}
 return {authenticated:true,walletAddress:user.walletAddress,savedReports:saved.results,watchlist:watches.results.map((w)=>{const {snapshot,...rest}=w;return {...rest,monitorEnabled:!!w.monitorEnabled,latestPriceUsd:parse(String(snapshot||""))?.priceUsd??null};}),notifications:alerts.results.map(a=>({...a,read:!!a.read})),preferences};
}
async function visibleReport(db:D1Database,id:unknown){
 if(typeof id!=="string"||!REPORT_ID.test(id))throw new Error("Choose a saved OLWIF report.");
 const row=await db.prepare("SELECT * FROM reports WHERE id=? AND hidden=0").bind(id).first<{id:string;token_key:string;address:string;chain:string;payload:string;created_at:number}>();
 if(!row)throw new Error("That report is not available.");
 if(!NETWORKS.includes(row.chain as typeof NETWORKS[number])||row.chain==="auto"||(row.chain==="solana"?!validSolanaAddress(row.address):!/^0x[a-f0-9]{40}$/i.test(row.address)))throw new Error("This report does not have a supported exact token identity.");
 const tokenKey=row.chain+":"+(row.chain==="solana"?row.address:row.address.toLowerCase());if(tokenKey!==row.token_key)throw new Error("Report identity mismatch.");
 const report=parse(row.payload);if(!report||report.target?.address!==row.address||report.target?.chain!==row.chain)throw new Error("Report identity mismatch.");
 return {...row,report};
}
export async function applyMemberAction(db:D1Database,user:MemberIdentity,body:Record<string,unknown>){
 await ensureMember(db,user.id);
 switch(body.action){
 case "saveReport":{const r=await visibleReport(db,body.reportId);await db.prepare("INSERT INTO saved_reports(member_id,report_id,created_at) SELECT ?,?,? WHERE (SELECT count(*) FROM saved_reports s JOIN reports r ON r.id=s.report_id WHERE s.member_id=? AND r.hidden=0)<100 ON CONFLICT(member_id,report_id) DO NOTHING").bind(user.id,r.id,Date.now(),user.id).run();const saved=await db.prepare("SELECT 1 FROM saved_reports WHERE member_id=? AND report_id=?").bind(user.id,r.id).first();if(!saved)throw new Error("Your library is full (100 reports). Remove a saved report first.");break;}
 case "removeReport":if(typeof body.reportId!=="string")throw new Error("Choose a report.");await db.prepare("DELETE FROM saved_reports WHERE member_id=? AND report_id=?").bind(user.id,body.reportId).run();break;
 case "addWatch":{const r=await visibleReport(db,body.reportId),snapshot=JSON.stringify(monitorSnapshot(r.report));
 // Both limits are checked by the INSERT itself. Count paused/hidden subscribers
 // in the shared ceiling, so resuming a watch cannot exceed the monitor fan-out.
 await db.prepare("INSERT INTO member_watches(member_id,token_key,report_id,monitor_enabled,baseline,created_at) SELECT ?,?,?,1,?,? WHERE ((SELECT count(*) FROM member_watches w JOIN reports r ON r.id=w.report_id WHERE w.member_id=? AND r.hidden=0)<20 OR EXISTS(SELECT 1 FROM member_watches w JOIN reports r ON r.id=w.report_id WHERE w.member_id=? AND w.token_key=? AND r.hidden=0)) AND ((SELECT count(*) FROM member_watches WHERE token_key=?)<500 OR EXISTS(SELECT 1 FROM member_watches WHERE member_id=? AND token_key=?)) ON CONFLICT(member_id,token_key) DO UPDATE SET report_id=excluded.report_id,baseline=excluded.baseline WHERE EXISTS(SELECT 1 FROM reports WHERE id=member_watches.report_id AND hidden=1)").bind(user.id,r.token_key,r.id,snapshot,Date.now(),user.id,user.id,r.token_key,r.token_key,user.id,r.token_key).run();
 if(!await db.prepare("SELECT 1 FROM member_watches w JOIN reports r ON r.id=w.report_id WHERE w.member_id=? AND w.token_key=? AND r.hidden=0").bind(user.id,r.token_key).first()){
 const subscribed=await db.prepare("SELECT 1 FROM member_watches WHERE member_id=? AND token_key=?").bind(user.id,r.token_key).first();
 const count=await db.prepare("SELECT count(*) AS total FROM member_watches WHERE token_key=?").bind(r.token_key).first<{total:number}>();
 if(!subscribed&&(count?.total||0)>=500)throw new Error("This token's shared monitoring list is full (500 accounts). Choose another token for now.");
 throw new Error("Your watchlist is full (20 tokens). Remove a token first.");}
 await db.prepare("INSERT INTO monitor_tokens(token_key,address,chain,report_id,snapshot,last_checked_at,last_attempt_at,lease_until) VALUES(?,?,?,?,?,?,0,0) ON CONFLICT(token_key) DO NOTHING").bind(r.token_key,r.address,r.chain,r.id,snapshot,r.created_at).run();break;}
 case "removeWatch":if(typeof body.tokenKey!=="string")throw new Error("Choose a watched token.");await db.prepare("DELETE FROM member_watches WHERE member_id=? AND token_key=?").bind(user.id,body.tokenKey).run();break;
 case "updatePosition":{if(typeof body.tokenKey!=="string")throw new Error("Choose a watched token.");const quantity=positionNumber(body.quantity),cost=positionNumber(body.costBasisUsd);await db.prepare("UPDATE member_watches SET quantity=?,cost_basis_usd=? WHERE member_id=? AND token_key=?").bind(quantity,cost,user.id,body.tokenKey).run();break;}
 case "updateWatch":if(typeof body.tokenKey!=="string"||typeof body.monitorEnabled!=="boolean")throw new Error("Choose a monitoring setting.");await db.prepare("UPDATE member_watches SET monitor_enabled=? WHERE member_id=? AND token_key=?").bind(Number(body.monitorEnabled),user.id,body.tokenKey).run();break;
 case "preferences":await db.prepare("UPDATE members SET preferences=? WHERE id=?").bind(JSON.stringify(memberPreferences(body.preferences)),user.id).run();break;
 case "markRead":if(body.all===true)await db.prepare("UPDATE member_alerts SET read=1 WHERE member_id=?").bind(user.id).run();else{if(typeof body.id!=="string"||body.id.length>200)throw new Error("Choose a notification.");await db.prepare("UPDATE member_alerts SET read=1 WHERE member_id=? AND id=?").bind(user.id,body.id).run();}break;
 case "deleteAccount":await db.batch(["DELETE FROM saved_reports WHERE member_id=?","DELETE FROM member_watches WHERE member_id=?","DELETE FROM member_alerts WHERE member_id=?","DELETE FROM members WHERE id=?"].map(q=>db.prepare(q).bind(user.id)));break;
 default:throw new Error("That account action is not supported.");
 }
}
