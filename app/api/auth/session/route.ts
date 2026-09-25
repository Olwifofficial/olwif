import { getMemberIdentity, memberAuthError, memberAuthJson } from "@/lib/member-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await getMemberIdentity(request);
    return memberAuthJson({ authenticated: !!user, user });
  } catch (error) { return memberAuthError(error); }
}
