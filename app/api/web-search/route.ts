import {assertSameOrigin} from "@/lib/security";
import {isOwner,json,runtime} from "@/lib/server";
export const dynamic="force-dynamic";

// Retired: all optional free-only searches now belong to the normal token check.
// A leftover credential must never activate the former provider.
export async function POST(request:Request){
 try {
  assertSameOrigin(request,runtime("SITE_ORIGIN"));
  if(!await isOwner())return json({error:"Owner access required during the private beta."},403);
  return json({error:"This retired search endpoint is not connected. Use a normal token check for the free-only public research workflow; no paid search fallback is enabled."},503);
 } catch {
  return json({error:"This request could not be accepted. Use the OLWIF token-check page."},400);
 }
}
