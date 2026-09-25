import { and, eq, gt, lte } from "drizzle-orm";
import { getDb } from "@/db";
import { walletChallenges, walletSessions } from "@/db/auth-schema";
import { consumeLimit, runtime } from "@/lib/server";
import { readJson } from "@/lib/security";
import {
  CHALLENGE_LIFETIME_MS, SESSION_LIFETIME_MS, WalletAuthError,
  assertWalletPost, authenticateWalletChallenge, decodeWalletAddress,
  hashToken, makeWalletMessage, randomToken, readSessionToken,
  resolveAuthOrigin, sessionCookie,
} from "./wallet-signin.js";

export type MemberIdentity = { id: string; walletAddress: string };

export function memberAuthJson(data: unknown, status = 200, cookie?: string) {
  const headers = new Headers({
    "Cache-Control": "private, no-store", "Pragma": "no-cache",
    "X-Content-Type-Options": "nosniff", "Vary": "Cookie",
  });
  if (cookie) headers.set("Set-Cookie", cookie);
  return Response.json(data, { status, headers });
}

export function memberAuthError(error: unknown) {
  if (error instanceof WalletAuthError) return memberAuthJson({ error: error.message }, error.status);
  return memberAuthJson({ error: "Member sign-in is temporarily unavailable. Please try again shortly." }, 503);
}

async function bodyFor(request: Request) {
  const origin = assertWalletPost(request, runtime("SITE_ORIGIN"));
  try { return { origin, body: await readJson(request, 2048) }; }
  catch (error) { throw new WalletAuthError((error as Error).message, 400); }
}

async function limitSignIn(request: Request, action: "challenge" | "verify", address: string) {
  // Apply the shared ceiling first so attacker-controlled addresses cannot create unlimited counters.
  if (!await consumeLimit(`auth:${action}:global`, 120, 600000)) {
    throw new WalletAuthError("Sign-in is busy. Please try again in a few minutes.", 429);
  }
  // Cloudflare sets this header at the edge; never accept forwarded-for chains as identity.
  const client = request.headers.get("cf-connecting-ip") || "local";
  const clientHash = await hashToken(client.slice(0, 64));
  if (!await consumeLimit(`auth:${action}:client:${clientHash}`, 30, 600000) ||
      !await consumeLimit(`auth:${action}:wallet:${address}`, action === "challenge" ? 6 : 12, 600000)) {
    throw new WalletAuthError("Too many sign-in attempts. Please try again in a few minutes.", 429);
  }
}

export async function issueWalletChallenge(request: Request) {
  const { origin, body } = await bodyFor(request);
  if (typeof body.address !== "string") throw new WalletAuthError("Choose a valid Solana wallet.");
  decodeWalletAddress(body.address);
  await limitSignIn(request, "challenge", body.address);
  const db = getDb();
  const issuedAt = Date.now(), expiresAt = issuedAt + CHALLENGE_LIFETIME_MS;
  const id = randomToken();
  const message = makeWalletMessage({ origin, address: body.address, nonce: randomToken(), issuedAt, expiresAt });
  await db.batch([
    db.delete(walletChallenges).where(lte(walletChallenges.expiresAt, issuedAt)),
    db.delete(walletSessions).where(lte(walletSessions.expiresAt, issuedAt)),
    db.insert(walletChallenges).values({ id, walletAddress: body.address, origin, message, issuedAt, expiresAt }),
  ]);
  return memberAuthJson({ challengeId: id, message, expiresAt: new Date(expiresAt).toISOString() });
}

export async function verifyWalletChallenge(request: Request) {
  const { origin, body } = await bodyFor(request);
  if (typeof body.address !== "string" || typeof body.challengeId !== "string" ||
      !/^[a-f0-9]{64}$/.test(body.challengeId) || typeof body.signature !== "string" || body.signature.length !== 88) {
    throw new WalletAuthError("The wallet sign-in response is incomplete. Please connect again.");
  }
  decodeWalletAddress(body.address);
  await limitSignIn(request, "verify", body.address);
  const db = getDb();
  const rows = await db.select().from(walletChallenges).where(eq(walletChallenges.id, body.challengeId)).limit(1);
  const identity = await authenticateWalletChallenge({
    challenge: rows[0], address: body.address, signature: body.signature, origin, now: Date.now(),
    consume: async (id: string) => {
      const deleted = await db.delete(walletChallenges).where(and(
        eq(walletChallenges.id, id), eq(walletChallenges.origin, origin),
        eq(walletChallenges.walletAddress, body.address as string), gt(walletChallenges.expiresAt, Date.now()),
      )).returning({ id: walletChallenges.id });
      return deleted.length === 1;
    },
  });
  const token = randomToken(), createdAt = Date.now();
  await db.insert(walletSessions).values({
    tokenHash: await hashToken(token), memberId: identity.id, walletAddress: identity.walletAddress,
    origin, createdAt, expiresAt: createdAt + SESSION_LIFETIME_MS,
  });
  return memberAuthJson({ authenticated: true, user: identity }, 200, sessionCookie(origin, token));
}

export async function getMemberIdentity(request: Request): Promise<MemberIdentity | null> {
  const origin = resolveAuthOrigin(request, runtime("SITE_ORIGIN"));
  const token = readSessionToken(request, origin);
  if (!token) return null;
  const rows = await getDb().select({ id: walletSessions.memberId, walletAddress: walletSessions.walletAddress })
    .from(walletSessions).where(and(
      eq(walletSessions.tokenHash, await hashToken(token)), eq(walletSessions.origin, origin),
      gt(walletSessions.expiresAt, Date.now()),
    )).limit(1);
  return rows[0] || null;
}

export async function logoutWalletSession(request: Request) {
  const { origin } = await bodyFor(request);
  const token = readSessionToken(request, origin);
  if (token) await getDb().delete(walletSessions).where(and(
    eq(walletSessions.tokenHash, await hashToken(token)), eq(walletSessions.origin, origin),
  ));
  return memberAuthJson({ authenticated: false, user: null }, 200, sessionCookie(origin, "", true));
}

export async function revokeMemberSessions(memberId: string) {
  await getDb().delete(walletSessions).where(eq(walletSessions.memberId, memberId));
}

export function logoutCookie(request: Request) {
  return sessionCookie(resolveAuthOrigin(request, runtime("SITE_ORIGIN")), "", true);
}
