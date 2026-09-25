import {env} from "cloudflare:workers";
import {getDb} from "@/db";
import {settings,owner,reports,limits} from "@/db/schema";
import {eq,desc,and,gte,sql} from "drizzle-orm";
import {getChatGPTUser} from "@/app/chatgpt-auth";
import {DEFAULT_SETTINGS,Settings,validateSettings} from "./security";
import {freeSearchWindows} from "./research/free-search-budget.js";
export function runtime(name:string){return String((env as unknown as Record<string,unknown>)[name]??process.env[name]??"");}
export async function getSettings():Promise<Settings>{
 const rows=await getDb().select().from(settings).where(eq(settings.key,"public")).limit(1);
 try{return rows[0]?validateSettings(JSON.parse(rows[0].value)):DEFAULT_SETTINGS;}catch{return DEFAULT_SETTINGS;}
}
export async function putSettings(value:Settings){await getDb().insert(settings).values({key:"public",value:JSON.stringify(value)}).onConflictDoUpdate({target:settings.key,set:{value:JSON.stringify(value)}});}
export async function isOwner(){
 const user=await getChatGPTUser();if(!user)return false;
 const db=getDb();let rows=await db.select().from(owner).where(eq(owner.key,"primary")).limit(1);
 if(rows[0])return rows[0].userId===user.userId;
 const email=runtime("ADMIN_EMAIL").trim().toLowerCase();if(!email||user.email.toLowerCase()!==email)return false;
 await db.insert(owner).values({key:"primary",userId:user.userId}).onConflictDoNothing();
 rows=await db.select().from(owner).where(eq(owner.key,"primary")).limit(1);
 return rows[0]?.userId===user.userId;
}
export function json(data:unknown,status=200){return Response.json(data,{status,headers:{"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});}
export async function recentReport(tokenKey:string){
 const identity=tokenKey.startsWith("auto:0x")
  ? and(sql`lower(${reports.address}) = ${tokenKey.slice(5).toLowerCase()}`,sql`json_extract(${reports.payload}, '$.target.chainResolution') = ${"Unique exact-base-token match in DEX Screener; verify the selected network independently."}`)
  : eq(reports.tokenKey,tokenKey);
 const rows=await getDb().select().from(reports).where(and(identity,eq(reports.hidden,false),gte(reports.createdAt,Date.now()-60000))).orderBy(desc(reports.createdAt)).limit(1);
 return rows[0]||null;
}
export async function consumeLimit(key:string,maximum:number,period:number){
 const db=getDb(),bucket=Math.floor(Date.now()/period),expires=(bucket+1)*period;
 const rows=await db.insert(limits).values({key:key+":"+bucket,count:1,expires}).onConflictDoUpdate({target:limits.key,set:{count:sql`${limits.count}+1`}}).returning({count:limits.count});
 return rows[0].count<=maximum;
}
export async function cleanLimits(){await getDb().delete(limits).where(sql`${limits.expires}<${Date.now()-86400000}`);}
// Persistent, atomic counters shared across tabs/workers; failed searches still
// consume a reservation. No retries or billing fallback after either ceiling.
export async function reserveFreeSearch(){
 const db=getDb();
 for(const budget of freeSearchWindows()){
  const rows=await db.insert(limits).values({key:budget.key,count:1,expires:budget.expires}).onConflictDoUpdate({target:limits.key,set:{count:sql`${limits.count}+1`}}).returning({count:limits.count});
  if(rows[0].count>budget.maximum)return false;
 }
 return true;
}
