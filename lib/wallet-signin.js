const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export const CHALLENGE_LIFETIME_MS = 5 * 60 * 1000;
export const SESSION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

export class WalletAuthError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "WalletAuthError";
    this.status = status;
  }
}

export function decodeWalletAddress(address) {
  if (typeof address !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
    throw new WalletAuthError("Choose a valid Solana wallet.");
  }
  let value = 0n;
  for (const character of address) value = value * 58n + BigInt(BASE58.indexOf(character));
  const bytes = [];
  while (value > 0n) { bytes.unshift(Number(value & 255n)); value >>= 8n; }
  for (const character of address) { if (character !== "1") break; bytes.unshift(0); }
  if (bytes.length !== 32) throw new WalletAuthError("Choose a valid Solana wallet.");
  return new Uint8Array(bytes);
}

export function randomToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashToken(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export function resolveAuthOrigin(request, configuredOrigin = "") {
  const requestUrl = new URL(request.url);
  const isLoopback = url => ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  let siteUrl;
  try {
    siteUrl = configuredOrigin ? new URL(configuredOrigin) : requestUrl;
  } catch {
    throw new WalletAuthError("Member sign-in is not configured yet.", 503);
  }
  if ((!configuredOrigin && !isLoopback(requestUrl)) ||
      (siteUrl.protocol !== "https:" && !(siteUrl.protocol === "http:" && isLoopback(siteUrl))) ||
      (configuredOrigin && (siteUrl.pathname !== "/" || siteUrl.search || siteUrl.hash || siteUrl.username || siteUrl.password))) {
    throw new WalletAuthError("Member sign-in is not configured yet.", 503);
  }
  if (requestUrl.origin !== siteUrl.origin) throw new WalletAuthError("Open OLWIF at its configured website address to sign in.", 403);
  return siteUrl.origin;
}

export function assertWalletPost(request, configuredOrigin = "") {
  const origin = resolveAuthOrigin(request, configuredOrigin);
  if (request.method !== "POST" || request.headers.get("origin") !== origin ||
      request.headers.get("sec-fetch-site") === "cross-site") {
    throw new WalletAuthError("Please sign in from the OLWIF website.", 403);
  }
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new WalletAuthError("Send a JSON request.", 415);
  }
  return origin;
}

export function makeWalletMessage({ origin, address, nonce, issuedAt, expiresAt }) {
  return `${new URL(origin).host} wants you to sign in with your Solana account:\n${address}\n\nSign in to OLWIF to save reports and follow your portfolio. This message does not authorize transactions or access to funds.\n\nURI: ${origin}/\nVersion: 1\nChain ID: solana:mainnet\nNonce: ${nonce}\nIssued At: ${new Date(issuedAt).toISOString()}\nExpiration Time: ${new Date(expiresAt).toISOString()}`;
}

export async function verifyWalletSignature(address, message, signature) {
  const publicKey = decodeWalletAddress(address);
  if (typeof message !== "string" || message.length > 2048 || typeof signature !== "string" ||
      !/^[A-Za-z0-9+/]{86}==$/.test(signature)) return false;
  let signatureBytes;
  try { signatureBytes = Uint8Array.from(atob(signature), character => character.charCodeAt(0)); }
  catch { return false; }
  if (signatureBytes.length !== 64) return false;
  // Native Ed25519 verification; the exact server-held message is always used.
  const key = await crypto.subtle.importKey("raw", publicKey, { name: "Ed25519" }, false, ["verify"]);
  return crypto.subtle.verify("Ed25519", key, signatureBytes, new TextEncoder().encode(message));
}

/** Verify first, then let the database atomically consume the challenge once. */
export async function authenticateWalletChallenge({ challenge, address, signature, origin, now, consume }) {
  if (!challenge || challenge.walletAddress !== address || challenge.origin !== origin ||
      challenge.expiresAt <= now || challenge.issuedAt > now ||
      challenge.expiresAt - challenge.issuedAt > CHALLENGE_LIFETIME_MS) {
    throw new WalletAuthError("This sign-in request has expired. Please connect again.", 401);
  }
  if (!await verifyWalletSignature(address, challenge.message, signature)) {
    throw new WalletAuthError("The wallet signature could not be verified. Please connect again.", 401);
  }
  if (!await consume(challenge.id)) {
    throw new WalletAuthError("This sign-in request was already used or has expired. Please connect again.", 401);
  }
  return { id: `solana:${address}`, walletAddress: address };
}

export function sessionCookieName(origin) {
  return new URL(origin).protocol === "https:" ? "__Host-olwif_session" : "olwif_session";
}

export function readSessionToken(request, origin) {
  const cookieHeader = request.headers.get("cookie") || "";
  if (cookieHeader.length > 8192) return null;
  const name = sessionCookieName(origin);
  const matches = cookieHeader.split(";").map(part => part.trim()).filter(part => part.startsWith(`${name}=`));
  if (matches.length !== 1) return null;
  const token = matches[0].slice(name.length + 1);
  return /^[a-f0-9]{64}$/.test(token) ? token : null;
}

export function sessionCookie(origin, token, clear = false) {
  return `${sessionCookieName(origin)}=${clear ? "" : token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : SESSION_LIFETIME_MS / 1000}${new URL(origin).protocol === "https:" ? "; Secure" : ""}`;
}
