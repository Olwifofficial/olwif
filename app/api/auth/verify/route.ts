import { verifyWalletChallenge, memberAuthError } from "@/lib/member-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try { return await verifyWalletChallenge(request); }
  catch (error) { return memberAuthError(error); }
}
