import {getMemberIdentity,revokeMemberSessions,logoutCookie,memberAuthJson as json} from "@/lib/member-auth";
import {applyMemberAction,getMemberState,memberDb} from "@/lib/member-store";
import {runtime,consumeLimit} from "@/lib/server";
import {assertSameOrigin,readJson} from "@/lib/security";
import {monitoringStatus} from "@/lib/member-monitor";
export const dynamic="force-dynamic";
export async function GET(request:Request){try{const user=await getMemberIdentity(request);if(!user)return json({authenticated:false},401);const state=await getMemberState(memberDb(),user);return json({...state,monitoring:await monitoringStatus(),rewards:{enabled:false,message:"Rewards are not open. No OLWIF token has launched and no bonus fund is connected."}});}catch{return json({error:"Your account could not be loaded. Please try again."},503);}}
export async function POST(request:Request){
 try{assertSameOrigin(request,runtime("SITE_ORIGIN"));}catch{return json({error:"Please use the OLWIF website."},403);}
 try{const user=await getMemberIdentity(request);if(!user)return json({error:"Sign in to save reports and manage your watchlist."},401);
 if(!await consumeLimit("member-write:"+user.id,30,60000))return json({error:"Please wait a minute before changing your account again."},429);
 const body=await readJson(request,4096);await applyMemberAction(memberDb(),user,body);
 if(body.action==="deleteAccount"){await revokeMemberSessions(user.id);const response=json({authenticated:false,deleted:true});response.headers.set("Set-Cookie",logoutCookie(request));return response;}
 return GET(request);
 }catch(e){const message=(e as Error).message;return json({error:/^(Choose|Enter|Invalid|That|This report|This token|Report identity|Your library|Your watchlist|Request|Send|Please)/.test(message)?message:"Your change could not be saved. Please try again."},400);}
}
