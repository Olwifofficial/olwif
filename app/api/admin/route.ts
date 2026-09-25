import {isOwner,json,runtime,getSettings,putSettings} from "@/lib/server";
import {assertSameOrigin,readJson,validateSettings} from "@/lib/security";
import {getDb} from "@/db";import {reports} from "@/db/schema";import {eq} from "drizzle-orm";
export const dynamic="force-dynamic";
export async function GET(){if(!await isOwner())return json({error:"Owner access required."},403);return json({settings:await getSettings(),githubConfigured:!!runtime("GITHUB_TOKEN"),searchConfigured:!!runtime("TAVILY_API_KEY")});}
export async function POST(request:Request){
 try{assertSameOrigin(request,runtime("SITE_ORIGIN"));if(!await isOwner())return json({error:"Owner access required."},403);
 const body=await readJson(request);if(body.action==="visibility"){
 if(typeof body.id!=="string"||! /^[a-f0-9-]{36}$/.test(body.id)||typeof body.hidden!=="boolean")throw new Error("Invalid report.");
 await getDb().update(reports).set({hidden:body.hidden}).where(eq(reports.id,body.id));return json({ok:true});}
 const settings=validateSettings(body.settings);await putSettings(settings);return json({ok:true});
 }catch(e){return json({error:(e as Error).message==="Invalid settings."?(e as Error).message:"The change could not be saved. Reload and try again."},400);}
}
