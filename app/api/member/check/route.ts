import {getMemberIdentity} from "@/lib/member-auth";
import {runMemberMonitor} from "@/lib/member-monitor";
import {assertSameOrigin,readJson} from "@/lib/security";
import {json,runtime,consumeLimit} from "@/lib/server";
export async function POST(request:Request){
 try{assertSameOrigin(request,runtime("SITE_ORIGIN"));await readJson(request,256);}catch{return json({error:"Please use the OLWIF website."},403);}
 try{const user=await getMemberIdentity(request);if(!user)return json({error:"Sign in to check your watchlist."},401);if(!await consumeLimit("member-check:"+user.id,2,60000))return json({error:"Please wait a minute before checking again."},429);return json(await runMemberMonitor({memberId:user.id,signal:request.signal}));}catch{return json({error:"Your watchlist could not be checked."},503);}
}
