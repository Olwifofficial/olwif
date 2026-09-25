// One selected pool, two public GETs, and no paid or historical fallback.
import { RESEARCH_CHAINS } from "./research-report.js";
import { createReadRequestSignal, throwIfAborted } from "./rpc-sources.js";

const API = "https://api.geckoterminal.com/api/v2/networks";
const MAX_TRADES = 300;
const CLOCK_SKEW_MS = 60000;
const DAY_MS = 24 * 60 * 60 * 1000;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const EVM_POOL = /^0x(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/;
const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const BASE58_SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;

function address(value, solana, pool = false) {
  if (typeof value !== "string" || !(solana ? BASE58_ADDRESS : pool ? EVM_POOL : EVM_ADDRESS).test(value)) return null;
  return solana ? value : value.toLowerCase();
}

function number(value, allowZero = false) {
  if (typeof value !== "number" && (typeof value !== "string" || !/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value))) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && (allowZero ? parsed >= 0 : parsed > 0) ? parsed : null;
}

function relationship(value, network, solana) {
  if (value?.type !== "token" || typeof value.id !== "string" || !value.id.startsWith(`${network}_`)) return null;
  return address(value.id.slice(network.length + 1), solana);
}

function verifyPool(payload, network, poolAddress, target, solana) {
  const pool = payload?.data;
  if (pool?.type !== "pool" || typeof pool.id !== "string" || !pool.id.startsWith(`${network}_`) ||
      address(pool.id.slice(network.length + 1), solana, true) !== poolAddress ||
      address(pool.attributes?.address, solana, true) !== poolAddress ||
      relationship(pool.relationships?.base_token?.data, network, solana) !== target) return null;
  const quote = relationship(pool.relationships?.quote_token?.data, network, solana);
  return quote && quote !== target ? quote : null;
}

function trade(row, { network, target, quote, solana, checkedMs }) {
  if (row?.type !== "trade" || typeof row.id !== "string" || !/^[a-zA-Z0-9_-]{1,240}$/.test(row.id) || !row.id.startsWith(`${network}_`)) return null;
  const attrs = row.attributes;
  if (!attrs || !["buy", "sell"].includes(attrs.kind)) return null;
  const wallet = address(attrs.tx_from_address, solana);
  if (!wallet || (!solana && /^0x0{40}$/.test(wallet))) return null;
  const hashPattern = solana ? BASE58_SIGNATURE : /^0x[0-9a-fA-F]{64}$/;
  if (typeof attrs.tx_hash !== "string" || !hashPattern.test(attrs.tx_hash)) return null;
  const from = address(attrs.from_token_address, solana), to = address(attrs.to_token_address, solana);
  const side = from === quote && to === target ? "buy" : from === target && to === quote ? "sell" : null;
  if (!side || side !== attrs.kind) return null;
  const buying = side === "buy";
  const tokenAmount = number(buying ? attrs.to_token_amount : attrs.from_token_amount);
  const priceUsd = number(buying ? attrs.price_to_in_usd : attrs.price_from_in_usd);
  const volumeUsd = number(attrs.volume_in_usd, true);
  // Keep verified buys and sells even when their amounts or prices are unknown.
  // Dropping a sell would bias buyer counts and any later net-position estimate.
  if (typeof attrs.block_timestamp !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(attrs.block_timestamp)) return null;
  const timestampMs = Date.parse(attrs.block_timestamp);
  if (!Number.isFinite(timestampMs) || timestampMs < checkedMs - DAY_MS - CLOCK_SKEW_MS || timestampMs > checkedMs + CLOCK_SKEW_MS) return null;
  const timestamp = new Date(timestampMs).toISOString();
  if (timestamp.slice(0, 19) !== attrs.block_timestamp.slice(0, 19)) return null;
  return { id: row.id, txHash: solana ? attrs.tx_hash : attrs.tx_hash.toLowerCase(), wallet, side, tokenAmount, priceUsd, volumeUsd, timestamp };
}

async function getJson(url, options) {
  const request = createReadRequestSignal(options.signal, options.timeoutMs ?? 7000);
  try {
    const response = await (options.fetchImpl || fetch)(url, {
      method: "GET", headers: { Accept: "application/json" }, signal: request.signal,
      redirect: "error", credentials: "omit", cache: "no-store"
    });
    throwIfAborted(request.signal);
    if (!response.ok) {
      const error = new Error("Public trade lookup did not complete.");
      error.status = response.status;
      throw error;
    }
    const payload = await response.json();
    throwIfAborted(request.signal);
    return payload;
  } finally { request.dispose(); }
}

function failureReason(error) {
  if ([401, 402, 403, 451].includes(error?.status)) return "The public trade source did not allow this request. No buyer activity was verified.";
  if (error?.status === 429) return "The free trade source is busy or has reached its request limit. Try refreshing later.";
  if (error?.status === 404) return "The free trade source has not indexed the selected pool.";
  if (["AbortError", "TimeoutError"].includes(error?.name)) return "The public trade source did not finish within the check's time limit.";
  return "The public trade source could not complete this check. Buyer activity remains unavailable.";
}

export async function collectBuyerActivity(report, options = {}) {
  throwIfAborted(options.signal);
  const checkedMs = Date.now(), checkedAt = new Date(checkedMs).toISOString();
  const chain = typeof report?.target?.chain === "string" && Object.hasOwn(RESEARCH_CHAINS, report.target.chain) ? report.target.chain : null;
  const network = chain ? RESEARCH_CHAINS[chain].gecko : null, solana = chain === "solana";
  const target = address(report?.target?.address, solana);
  const poolAddress = address(report?.research?.market?.pairAddress, solana, true);
  const poolApi = network && poolAddress ? `${API}/${network}/pools/${poolAddress}` : null;
  const result = {
    version: 1, status: "unavailable", checkedAt, chain, address: target, poolAddress,
    poolUrl: network && poolAddress ? `https://www.geckoterminal.com/${network}/pools/${poolAddress}` : null,
    source: "GeckoTerminal trades", sourceUrl: poolApi ? `${poolApi}/trades` : null,
    maxTrades: MAX_TRADES, trades: []
  };
  if (!network) return { ...result, status: "unsupported", reason: "No free trade source is configured for this network." };
  if (!target || !poolAddress) return { ...result, reason: "An exact token and selected market pool are needed for buyer activity." };
  try {
    const pool = await getJson(poolApi, options);
    const quote = verifyPool(pool, network, poolAddress, target, solana);
    if (!quote) return { ...result, reason: "The trade source did not confirm the selected pool, network and exact base token together." };
    const payload = await getJson(`${poolApi}/trades`, options);
    if (!Array.isArray(payload?.data)) return { ...result, reason: "The trade source did not return a usable trade list for the selected pool." };
    const rows = payload.data.slice(0, MAX_TRADES), unique = new Map(), conflicts = new Set(), invalidIds = new Set();
    let rejectedTrades = 0, duplicateTrades = 0;
    for (const row of rows) {
      const normalized = trade(row, { network, target, quote, solana, checkedMs });
      if (!normalized) {
        rejectedTrades++;
        if (typeof row?.id === "string") {
          invalidIds.add(row.id);
          if (unique.has(row.id)) conflicts.add(row.id);
        }
        continue;
      }
      if (invalidIds.has(normalized.id)) conflicts.add(normalized.id);
      if (unique.has(normalized.id)) {
        duplicateTrades++;
        if (JSON.stringify(unique.get(normalized.id)) !== JSON.stringify(normalized)) conflicts.add(normalized.id);
      } else unique.set(normalized.id, normalized);
    }
    // A transaction can contain several swaps: only event IDs are deduplicated.
    const trades = [...unique.values()].filter(row => !conflicts.has(row.id)).sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id));
    rejectedTrades += conflicts.size;
    const metadata = {
      returnedTrades: rows.length, rejectedTrades, duplicateTrades,
      truncated: payload.data.length >= MAX_TRADES,
      windowStart: trades[0]?.timestamp || null, windowEnd: trades.at(-1)?.timestamp || null
    };
    if (rows.length && !trades.length) return { ...result, ...metadata, reason: "No returned trade passed the exact-token, sender and timestamp checks." };
    return { ...result, ...metadata, status: "available", trades };
  } catch (error) {
    // User cancellation is terminal; provider timeout is an unavailable snapshot.
    throwIfAborted(options.signal);
    return { ...result, reason: failureReason(error) };
  }
}
