// Public fallback reads only. Never send or retry a signed transaction here.
export const PUBLIC_SOLANA_RPC_URLS = Object.freeze([
  "https://solana-rpc.publicnode.com",
  "https://rpc.solanatracker.io/public",
  "https://api.mainnet-beta.solana.com"
]);

const READ_METHODS = new Set([
  "getAccountInfo", "getTokenLargestAccounts"
]);

export function throwIfAborted(signal) {
  if (signal?.aborted) throw signal.reason || new DOMException("The request was cancelled.", "AbortError");
}

// Each request owns its timeout and forwarding listener. Always dispose after
// reading the body, so Stop cancels in-flight reads without retaining listeners.
export function createReadRequestSignal(signal, timeoutMs = 12000) {
  throwIfAborted(signal);
  const controller = new AbortController();
  const cancel = () => controller.abort(signal.reason);
  signal?.addEventListener("abort", cancel, { once: true });
  const timeout = Math.max(100, Math.min(12000, Number(timeoutMs) || 12000));
  const timer = setTimeout(() => controller.abort(), timeout);
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
    }
  };
}

function endpointUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    parsed.hash = "";
    return parsed.href;
  } catch { return null; }
}

export function rpcProviderLabel(value) {
  try { return new URL(value).hostname; } catch { return "Solana provider"; }
}

function failureMessage(error) {
  if (error?.name === "AbortError") return "The provider did not respond in time.";
  if (error?.code === "ACCESS") return "This provider is not accepting public requests right now.";
  if (error?.code === "BUSY") return "This provider is busy; another source was tried.";
  if (error?.code === "DATA") return "This provider did not return usable data for this check.";
  return "This provider could not be reached or did not complete the check.";
}

function sourceError(code) {
  const error = new Error("Public data check did not complete.");
  error.code = code;
  return error;
}

function validReadResult(method, result) {
  const unsigned = (value) => Number.isSafeInteger(value) && value >= 0;
  const hasValue = result != null && typeof result === "object" && Object.hasOwn(result, "value");
  if (["getBalance"].includes(method)) return hasValue && unsigned(result.value);
  if (["getSlot", "getBlockHeight", "getMinimumBalanceForRentExemption"].includes(method)) return unsigned(result);
  if (method === "getGenesisHash") return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(result);
  if (method === "getHealth") return result === "ok";
  if (method === "getTransaction") return result === null || typeof result === "object";
  if (method === "getAccountInfo") return hasValue && (result.value === null || typeof result.value === "object");
  if (["getMultipleAccounts", "getTokenLargestAccounts", "getTokenAccountsByOwner", "getSignatureStatuses"].includes(method)) return hasValue && Array.isArray(result.value);
  if (method === "isBlockhashValid") return hasValue && typeof result.value === "boolean";
  if (method === "getFeeForMessage") return hasValue && (result.value === null || unsigned(result.value));
  if (method === "getLatestBlockhash") return hasValue && typeof result.value?.blockhash === "string" && unsigned(result.value.lastValidBlockHeight);
  if (method === "getTokenSupply") return hasValue && /^\d+$/.test(result.value?.amount || "");
  if (method === "simulateTransaction") return hasValue && result.value != null && Object.hasOwn(result.value, "err");
  return false;
}

export async function rpcWithSources(method, params, {
  rpcUrl,
  fetchImpl = fetch,
  timeoutMs = 4500,
  validate,
  signal
} = {}) {
  throwIfAborted(signal);
  if (!READ_METHODS.has(method)) throw new Error("Fallback data sources allow read-only checks only.");
  const uniqueHosts = new Map();
  for (const url of [rpcUrl, ...PUBLIC_SOLANA_RPC_URLS].filter(Boolean).map(endpointUrl).filter(Boolean)) {
    const host = rpcProviderLabel(url);
    if (!uniqueHosts.has(host)) uniqueHosts.set(host, url);
  }
  const urls = [...uniqueHosts.values()].slice(0, 4);
  const attempts = [];
  const timeout = Math.max(100, Math.min(12000, Number(timeoutMs) || 4500));
  for (const url of urls) {
    throwIfAborted(signal);
    const provider = rpcProviderLabel(url);
    const request = createReadRequestSignal(signal, timeout);
    try {
      const response = await fetchImpl(url, {
        method: "POST", signal: request.signal,
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
      });
      throwIfAborted(request.signal);
      if (!response.ok) throw sourceError([401, 403].includes(response.status) ? "ACCESS" : response.status === 429 ? "BUSY" : "NETWORK");
      const payload = await response.json();
      throwIfAborted(request.signal);
      if (!payload || payload.jsonrpc !== "2.0" || payload.error || !Object.hasOwn(payload, "result")) throw sourceError("DATA");
      if (!validReadResult(method, payload.result)) throw sourceError("DATA");
      if (validate && !validate(payload.result)) throw sourceError("DATA");
      const checkedAt = new Date().toISOString();
      attempts.push({ provider, ok: true });
      return { data: payload.result, provider, checkedAt, attempts };
    } catch (error) {
      // A user stop is terminal, whereas one provider's timeout may fall back.
      throwIfAborted(signal);
      attempts.push({ provider, ok: false, message: failureMessage(error) });
    } finally { request.dispose(); }
  }
  const error = new Error(`Could not verify this check after trying ${attempts.length} independent provider${attempts.length === 1 ? "" : "s"}. Refresh checks later; public providers may be busy or limit this query.`);
  error.attempts = attempts;
  error.checkedAt = new Date().toISOString();
  throw error;
}

export async function rpcRequest(method, params, options) {
  return (await rpcWithSources(method, params, options)).data;
}
