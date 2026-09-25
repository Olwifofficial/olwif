import { logoutWalletSession, memberAuthError } from "@/lib/member-auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try { return await logoutWalletSession(request); }
  catch (error) { return memberAuthError(error); }
}
