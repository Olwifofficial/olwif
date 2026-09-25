import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { drizzle } from "drizzle-orm/sqlite-proxy";
import ts from "typescript";
import {
  CHALLENGE_LIFETIME_MS, assertWalletPost, authenticateWalletChallenge, decodeWalletAddress,
  hashToken, makeWalletMessage, randomToken, readSessionToken, resolveAuthOrigin,
  sessionCookie, verifyWalletSignature,
} from "../lib/wallet-signin.js";

const origin = "https://olwif.example";
const moduleSource = source => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
function tsModule(file, replacements = {}) {
  let source = readFileSync(new URL(file, import.meta.url), "utf8");
  for (const [from, to] of Object.entries(replacements)) source = source.replaceAll(JSON.stringify(from), JSON.stringify(to));
  return moduleSource(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
}
const schemaUrl = tsModule("../db/auth-schema.ts", { "drizzle-orm/sqlite-core": import.meta.resolve("drizzle-orm/sqlite-core") });
const dbUrl = moduleSource("export const getDb = () => globalThis.__walletAuthFixture.db;");
const serverUrl = moduleSource(`
  export const runtime = () => globalThis.__walletAuthFixture.origin;
  export async function consumeLimit(key, max, period) {
    const counts = globalThis.__walletAuthFixture.counts;
    const bucket = key + ':' + Math.floor(Date.now()/period);
    const count = (counts.get(bucket) || 0) + 1;
    counts.set(bucket, count);
    return count <= max;
  }
`);
const member = await import(tsModule("../lib/member-auth.ts", {
  "drizzle-orm": import.meta.resolve("drizzle-orm"), "@/db": dbUrl, "@/db/auth-schema": schemaUrl,
  "@/lib/server": serverUrl, "@/lib/security": tsModule("../lib/security.ts"),
  "./wallet-signin.js": new URL("../lib/wallet-signin.js", import.meta.url).href,
}));

function fixture(configuredOrigin = origin) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("../drizzle/0002_wallet_auth.sql", import.meta.url), "utf8"));
  const execute = async (sql, parameters, method) => {
    const statement = sqlite.prepare(sql);
    if (method === "run") { statement.run(...parameters); return { rows: [] }; }
    return { rows: statement.all(...parameters).map(row => Object.values(row)) };
  };
  const db = drizzle(execute, async operations => {
    sqlite.exec("BEGIN");
    try {
      const results = [];
      for (const { sql, params, method } of operations) results.push(await execute(sql, params, method));
      sqlite.exec("COMMIT");
      return results;
    } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  });
  globalThis.__walletAuthFixture = { db, sqlite, counts: new Map(), origin: configuredOrigin };
  return sqlite;
}
const post = (path, body = {}, extra = {}) => new Request(`${origin}/api/auth/${path}`, {
  method: "POST", headers: { origin, "content-type": "application/json", ...extra }, body: JSON.stringify(body),
});
const encodeBase58 = bytes => {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = 0n, encoded = "";
  for (const byte of bytes) value = (value << 8n) + BigInt(byte);
  while (value > 0n) { encoded = alphabet[Number(value % 58n)] + encoded; value /= 58n; }
  for (const byte of bytes) { if (byte !== 0) break; encoded = "1" + encoded; }
  return encoded;
};
async function wallet() {
  const keys = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const address = encodeBase58(new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey)));
  return {
    address,
    sign: async message => Buffer.from(await crypto.subtle.sign("Ed25519", keys.privateKey, new TextEncoder().encode(message))).toString("base64"),
  };
}
async function signIn(account) {
  const challengeResponse = await member.issueWalletChallenge(post("challenge", { address: account.address }));
  const challenge = await challengeResponse.json();
  const proof = { challengeId: challenge.challengeId, address: account.address, signature: await account.sign(challenge.message) };
  const response = await member.verifyWalletChallenge(post("verify", proof));
  const cookie = response.headers.get("set-cookie").split(";", 1)[0];
  return { response, proof, cookie, challenge };
}

test("wallet keys must decode to exactly 32 bytes", () => {
  assert.equal(decodeWalletAddress("So11111111111111111111111111111111111111112").length, 32);
  assert.equal(decodeWalletAddress("1".repeat(32)).length, 32);
  for (const address of ["1".repeat(33), "z".repeat(44), "0x123", "<script>", null]) {
    assert.throws(() => decodeWalletAddress(address), /valid Solana/);
  }
});

test("signatures authenticate the exact message and wallet", async () => {
  const alice = await wallet(), bob = await wallet();
  const now = Date.now();
  const message = makeWalletMessage({ origin, address: alice.address, nonce: randomToken(), issuedAt: now, expiresAt: now + CHALLENGE_LIFETIME_MS });
  const signature = await alice.sign(message);
  assert.equal(await verifyWalletSignature(alice.address, message, signature), true);
  assert.equal(await verifyWalletSignature(bob.address, message, signature), false);
  assert.equal(await verifyWalletSignature(alice.address, `${message}!`, signature), false);
  assert.equal(await verifyWalletSignature(alice.address, message, "A".repeat(88)), false);
  assert.equal(await verifyWalletSignature(alice.address, message, "A".repeat(84) + "===="), false);
});

test("production requires a configured exact HTTPS origin; forwarded hosts cannot choose it", () => {
  assert.throws(() => resolveAuthOrigin(new Request(`${origin}/api/auth/session`)), /not configured/);
  assert.throws(() => resolveAuthOrigin(new Request("https://evil.example/api", { headers: { "x-forwarded-host": "olwif.example" } }), origin), /configured website/);
  assert.throws(() => resolveAuthOrigin(new Request("http://olwif.example/api"), "http://olwif.example"), /not configured/);
  for (const bad of ["not a url", `${origin}/login`, `${origin}/?x=y`, "https://user:password@olwif.example"]) {
    assert.throws(() => resolveAuthOrigin(new Request(`${origin}/api`), bad), /not configured/);
  }
  assert.equal(resolveAuthOrigin(new Request("http://127.0.0.1:3000/api")), "http://127.0.0.1:3000");
  assert.equal(resolveAuthOrigin(new Request(`${origin}/api`), origin), origin);
});

test("wallet mutations require exact Origin and JSON", () => {
  assert.equal(assertWalletPost(post("challenge"), origin), origin);
  assert.throws(() => assertWalletPost(post("challenge", {}, { origin: "https://evil.example" }), origin), /OLWIF website/);
  assert.throws(() => assertWalletPost(post("challenge", {}, { origin: "null" }), origin), /OLWIF website/);
  assert.throws(() => assertWalletPost(post("challenge", {}, { "sec-fetch-site": "cross-site" }), origin), /OLWIF website/);
  assert.throws(() => assertWalletPost(post("challenge", {}, { "content-type": "application/json-attacker" }), origin), /JSON/);
});

test("challenge expiry, wrong origin and wrong address fail before consumption", async () => {
  const alice = await wallet();
  const now = Date.now();
  const challenge = { id: randomToken(), walletAddress: alice.address, origin, issuedAt: now - 1000, expiresAt: now + 1000, message: "message" };
  let consumes = 0;
  const base = { challenge, address: alice.address, signature: await alice.sign("message"), origin, now, consume: async () => { consumes++; return true; } };
  await assert.rejects(authenticateWalletChallenge({ ...base, now: challenge.expiresAt }), /expired/);
  await assert.rejects(authenticateWalletChallenge({ ...base, origin: "https://other.example" }), /expired/);
  await assert.rejects(authenticateWalletChallenge({ ...base, address: (await wallet()).address }), /expired/);
  assert.equal(consumes, 0);
});

test("database-backed sign-in stores only token hashes and stable member identity", async () => {
  const sqlite = fixture(), alice = await wallet();
  const { response, cookie, challenge } = await signIn(alice);
  assert.deepEqual(await response.json(), { authenticated: true, user: { id: `solana:${alice.address}`, walletAddress: alice.address } });
  assert.match(challenge.message, /URI: https:\/\/olwif.example\//);
  assert.match(challenge.message, /Nonce: [a-f0-9]{64}/);
  assert.match(challenge.message, /Issued At: /);
  assert.match(challenge.message, /Expiration Time: /);
  assert.match(response.headers.get("set-cookie"), /^__Host-olwif_session=.*HttpOnly; SameSite=Strict; Max-Age=604800; Secure$/);
  const token = cookie.split("=")[1];
  const stored = sqlite.prepare("SELECT * FROM wallet_sessions").get();
  assert.equal(stored.token_hash, await hashToken(token));
  assert.notEqual(stored.token_hash, token);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM wallet_challenges").get().n, 0);
  const authenticated = await member.getMemberIdentity(new Request(`${origin}/api/auth/session`, { headers: { cookie } }));
  assert.deepEqual(authenticated, { id: `solana:${alice.address}`, walletAddress: alice.address });
  sqlite.close();
});

test("a signed challenge is single-use under sequential and concurrent replay", async () => {
  const sqlite = fixture(), alice = await wallet();
  const challenge = await (await member.issueWalletChallenge(post("challenge", { address: alice.address }))).json();
  const proof = { challengeId: challenge.challengeId, address: alice.address, signature: await alice.sign(challenge.message) };
  const attempts = await Promise.allSettled([member.verifyWalletChallenge(post("verify", proof)), member.verifyWalletChallenge(post("verify", proof))]);
  assert.equal(attempts.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(attempts.filter(result => result.status === "rejected").length, 1);
  await assert.rejects(member.verifyWalletChallenge(post("verify", proof)), /expired|already used/);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM wallet_sessions").get().n, 1);
  sqlite.close();
});

test("a forged signature cannot consume the valid challenge", async () => {
  const sqlite = fixture(), alice = await wallet(), bob = await wallet();
  const challenge = await (await member.issueWalletChallenge(post("challenge", { address: alice.address }))).json();
  const proof = { challengeId: challenge.challengeId, address: alice.address, signature: await bob.sign(challenge.message) };
  await assert.rejects(member.verifyWalletChallenge(post("verify", proof)), /could not be verified/);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM wallet_challenges").get().n, 1);
  proof.signature = await alice.sign(challenge.message);
  assert.equal((await member.verifyWalletChallenge(post("verify", proof))).status, 200);
  sqlite.close();
});

test("expired challenges and sessions never authenticate", async () => {
  const sqlite = fixture(), alice = await wallet();
  const challenge = await (await member.issueWalletChallenge(post("challenge", { address: alice.address }))).json();
  sqlite.prepare("UPDATE wallet_challenges SET expires_at = ?").run(Date.now() - 1);
  await assert.rejects(member.verifyWalletChallenge(post("verify", { challengeId: challenge.challengeId, address: alice.address, signature: await alice.sign(challenge.message) })), /expired/);
  const { cookie } = await signIn(alice);
  sqlite.prepare("UPDATE wallet_sessions SET expires_at = ?").run(Date.now() - 1);
  assert.equal(await member.getMemberIdentity(new Request(`${origin}/api`, { headers: { cookie } })), null);
  sqlite.close();
});

test("ChatGPT headers, a wallet address and guessed cookies never confer membership", async () => {
  const sqlite = fixture(), alice = await wallet();
  const headers = {
    "x-chatgpt-user-id": "owner", "x-chatgpt-user-email": "owner@example.com", "x-wallet-address": alice.address,
    "cookie": `__Host-olwif_session=${randomToken()}`,
  };
  assert.equal(await member.getMemberIdentity(new Request(`${origin}/api`, { headers })), null);
  assert.equal(await member.getMemberIdentity(new Request(`${origin}/api`)), null);
  sqlite.close();
});

test("logout revokes the server session and clears the protected cookie", async () => {
  const sqlite = fixture(), alice = await wallet();
  const { cookie } = await signIn(alice);
  const response = await member.logoutWalletSession(post("logout", {}, { cookie }));
  assert.match(response.headers.get("set-cookie"), /Max-Age=0; Secure/);
  assert.equal(await member.getMemberIdentity(new Request(`${origin}/api`, { headers: { cookie } })), null);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM wallet_sessions").get().n, 0);
  sqlite.close();
});

test("account deletion can revoke every session for a member", async () => {
  const sqlite = fixture(), alice = await wallet(), bob = await wallet();
  await signIn(alice); await signIn(alice); await signIn(bob);
  await member.revokeMemberSessions(`solana:${alice.address}`);
  const remaining = sqlite.prepare("SELECT member_id FROM wallet_sessions").all();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].member_id, `solana:${bob.address}`);
  assert.match(member.logoutCookie(new Request(`${origin}/api`)), /Max-Age=0/);
  sqlite.close();
});

test("oversized body and repeated challenges are bounded", async () => {
  const sqlite = fixture(), alice = await wallet();
  await assert.rejects(member.issueWalletChallenge(post("challenge", { address: alice.address, padding: "x".repeat(3000) })), /too large/);
  for (let index = 0; index < 6; index++) await member.issueWalletChallenge(post("challenge", { address: alice.address }));
  await assert.rejects(member.issueWalletChallenge(post("challenge", { address: alice.address })), /Too many/);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM wallet_challenges").get().n, 6);
  sqlite.close();
});

test("cookie parsing rejects ambiguity and only permits loopback cookies on HTTP", () => {
  const token = randomToken();
  assert.equal(readSessionToken(new Request(origin, { headers: { cookie: `__Host-olwif_session=${token}` } }), origin), token);
  assert.equal(readSessionToken(new Request(origin, { headers: { cookie: `__Host-olwif_session=${token}; __Host-olwif_session=${token}` } }), origin), null);
  assert.equal(readSessionToken(new Request(origin, { headers: { cookie: `olwif_session=${token}` } }), origin), null);
  assert.match(sessionCookie("http://127.0.0.1:3000", token), /^olwif_session=/);
  assert.doesNotMatch(sessionCookie("http://127.0.0.1:3000", token), /Secure/);
});
