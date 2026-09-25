import { RESEARCH_CHAINS, explorerLink } from "./research-report.js";

const MAX_TRADES = 300;
const MAX_WALLETS = 20;
const DAY = 24 * 60 * 60 * 1000;
const RECENT = 15 * 60 * 1000;
const positive = value => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
const amount = value => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const addressKey = (chain, value) => typeof value === "string" && explorerLink(chain, value) ? chain === "solana" ? value : value.toLowerCase() : null;
const poolKey = (chain, value) => chain === "solana" ? addressKey(chain, value) : typeof value === "string" && /^0x(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/.test(value) ? value.toLowerCase() : null;
const tradeId = value => typeof value === "string" && value.length > 0 && value.length <= 256 && value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value) ? value : null;

function timestamp(value) {
 if (typeof value !== "string") return null;
 const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
 if (!match || +match[4] > 23 || +match[5] > 59 || +match[6] > 59) return null;
 const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
 if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value.slice(0, 10)) return null;
 const time = Date.parse(value);
 return Number.isFinite(time) ? time : null;
}

const DEFINITIONS = Object.freeze({
 buyers: "Unique wallets with at least one buy in the returned sample; wallets are not necessarily independent people.",
 firstSeenRecently: "First seen recently: the wallet's earliest returned trade is a buy within the 15 minutes before this check. An earlier sampled sell, including one at the same timestamp, excludes it. This does not confirm a new holder or first-ever purchase.",
 repeatBuyers: "Wallets with at least two buys in the returned sample.",
 netBuyers: "Wallets that bought more tokens than they sold in the returned sample. Every sampled trade for that wallet must have a usable token amount; this is not its current balance.",
 buyingLower: "Wallets with a later buy below their token-volume-weighted price of earlier sampled buys. Same-time buys are not ordered. This is not wallet cost basis or confirmed averaging down; missing prices or amounts can prevent comparison."
});
const CAVEAT = "Saved sample of at most 300 trades from the preceding 24 hours in one pool, not complete wallet or token history. Groups can overlap. Provider indexing delay and activity in other pools are unknown.";

function summarizeWallet(wallet, trades, chain, checkedTime) {
 const buys = trades.filter(trade => trade.side === "buy");
 const sells = trades.filter(trade => trade.side === "sell");
 const sum = rows => {
  if (rows.some(row => row.tokenAmount === null)) return null;
  const total = rows.reduce((value, row) => value + row.tokenAmount, 0);
  return Number.isFinite(total) ? total : null;
 };
 const boughtTokens = sum(buys), soldTokens = sum(sells);
 const difference = boughtTokens !== null && soldTokens !== null ? boughtTokens - soldTokens : null;
 const netTokens = difference !== null && Number.isFinite(difference) ? difference : null;
 const first = trades[0].time, last = trades.at(-1).time;
 const firstTrades = trades.filter(trade => trade.time === first);
 let priorTokens = 0, priorValue = 0, priorBuys = 0, priorComplete = true;
 let comparisons = 0, lowerBuyCount = 0, missingComparison = false;
 // Accumulate an entire timestamp group only after comparing it to the past.
 // This prevents the arbitrary response order from ordering simultaneous buys.
 for (let index = 0; index < buys.length;) {
  let end = index + 1;
  while (end < buys.length && buys[end].time === buys[index].time) end++;
  const group = buys.slice(index, end);
  for (const buy of group) {
   if (!priorBuys) continue;
   const usable = priorComplete && priorTokens > 0 && Number.isFinite(priorValue) && buy.priceUsd !== null && buy.tokenAmount !== null;
   if (!usable) { missingComparison = true; continue; }
   comparisons++;
   if (buy.priceUsd < priorValue / priorTokens) lowerBuyCount++;
  }
  for (const buy of group) {
   priorBuys++;
   if (buy.priceUsd === null || buy.tokenAmount === null) { priorComplete = false; continue; }
   priorTokens += buy.tokenAmount;
   priorValue += buy.tokenAmount * buy.priceUsd;
   if (!Number.isFinite(priorTokens) || !Number.isFinite(priorValue)) priorComplete = false;
  }
  index = end;
 }
 return {
  wallet, url: explorerLink(chain, wallet), buyCount: buys.length, sellCount: sells.length,
  boughtTokens, soldTokens, netTokens, lowerBuyCount: comparisons ? lowerBuyCount : null,
  firstSeen: new Date(first).toISOString(), lastSeen: new Date(last).toISOString(),
  flags: {
   newInSample: buys.length > 0 && first >= checkedTime - RECENT && firstTrades.every(trade => trade.side === "buy"),
   repeat: buys.length >= 2,
   netBuyer: buys.length && netTokens !== null ? netTokens > 0 : null,
   buyingLower: lowerBuyCount > 0 ? true : !comparisons || missingComparison ? null : false
  }
 };
}

/**
 * Saved, descriptive evidence only: never changes a score or recommendation.
 * Counts cover the full accepted sample; wallets holds at most 20 buying-wallet
 * rows. A null count/flag means no assessment, while zero is an observed count.
 * coverage gives the assessable buyer denominator for amount/price metrics.
 */
export function buyerBehaviour(input = {}) {
 const report = input && typeof input === "object" ? input : {};
 const activity = report.research?.buyerActivity;
 const empty = {
  status: "unavailable", reason: "This report has no saved wallet-level trade sample.",
  checkedAt: null, source: null, sourceUrl: null, poolUrl: null,
  sample: { start: null, end: null, tradeCount: 0, maxTrades: MAX_TRADES, windowHours: 24, discardedTrades: 0, duplicateTrades: 0 },
  counts: { buyers: null, firstSeenRecently: null, repeatBuyers: null, netBuyers: null, buyingLower: null },
  coverage: { netBuyers: 0, buyingLower: 0 }, wallets: [], definitions: { ...DEFINITIONS }, caveat: CAVEAT
 };
 const unavailable = reason => ({ ...empty, reason });
 if (!activity || typeof activity !== "object") return empty;
 if (activity.version !== 1) return unavailable("This saved wallet sample has an unsupported format.");
 const chain = report.target?.chain;
 if (typeof chain !== "string" || !Object.hasOwn(RESEARCH_CHAINS, chain)) return unavailable("The report network is not supported for wallet activity.");
 const address = addressKey(chain, report.target?.address);
 if (!address || activity.chain !== chain || addressKey(chain, activity.address) !== address) return unavailable("The saved wallet sample does not match this report's network and token.");
 if (activity.status === "unsupported") return { ...empty, status: "unsupported", reason: "Wallet-level trade history is not supported by this source for the selected network." };
 if (activity.status !== "available") return unavailable("Wallet-level trade history was unavailable when this report was checked.");
 const pool = poolKey(chain, activity.poolAddress);
 if (!pool || pool !== poolKey(chain, report.research?.market?.pairAddress)) return unavailable("The saved wallet sample does not match this report's selected pool.");
 const checkedTime = timestamp(activity.checkedAt);
 if (checkedTime === null) return unavailable("The saved wallet sample has no usable check timestamp.");
 const generatedTime = timestamp(report.generatedAt);
 if (generatedTime !== null && (generatedTime - checkedTime > DAY || checkedTime - generatedTime > 5 * 60 * 1000)) return unavailable("The saved wallet sample is stale or inconsistent with this report's timestamp.");
 if (!Array.isArray(activity.trades)) return unavailable("The source did not return a usable wallet-level trade list.");

 const ids = new Map(), rejected = new Set();
 let discardedTrades = count(activity.rejectedTrades), duplicateTrades = count(activity.duplicateTrades);
 for (const raw of activity.trades) {
  const id = tradeId(raw?.id);
  const wallet = addressKey(chain, raw?.wallet);
  const time = timestamp(raw?.timestamp);
  const valid = id && wallet && !(chain !== "solana" && /^0x0{40}$/.test(wallet)) && (raw.side === "buy" || raw.side === "sell") && time !== null && time <= checkedTime && time >= checkedTime - DAY;
  const txHash = typeof raw?.txHash === "string" ? chain === "solana" ? raw.txHash : raw.txHash.toLowerCase() : null;
  const trade = valid ? { id, txHash, wallet, time, side: raw.side, tokenAmount: positive(raw.tokenAmount), priceUsd: positive(raw.priceUsd), volumeUsd: amount(raw.volumeUsd) } : null;
  if (!id) { discardedTrades++; continue; }
  if (rejected.has(id)) { discardedTrades++; continue; }
  if (ids.has(id)) {
   if (trade && JSON.stringify(ids.get(id)) === JSON.stringify(trade)) duplicateTrades++;
   else { ids.delete(id); rejected.add(id); discardedTrades += 2; }
   continue;
  }
  if (!trade) { discardedTrades++; rejected.add(id); continue; }
  ids.set(id, trade);
 }
 const accepted = [...ids.values()].sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
 discardedTrades += Math.max(0, accepted.length - MAX_TRADES);
 const trades = accepted.slice(-MAX_TRADES);
 if (activity.trades.length && !trades.length) return { ...unavailable("No usable trades remain in the returned wallet sample."), sample: { ...empty.sample, discardedTrades, duplicateTrades } };
 const groups = new Map();
 for (const trade of trades) {
  if (!groups.has(trade.wallet)) groups.set(trade.wallet, []);
  groups.get(trade.wallet).push(trade);
 }
 const wallets = [...groups].map(([wallet, rows]) => summarizeWallet(wallet, rows, chain, checkedTime));
 const buyers = wallets.filter(row => row.buyCount > 0);
 const netEligible = buyers.filter(row => row.flags.netBuyer !== null);
 const lowerEligible = buyers.filter(row => row.flags.buyingLower !== null);
 const gecko = RESEARCH_CHAINS[chain].gecko;
 const poolUrl = gecko ? `https://www.geckoterminal.com/${gecko}/pools/${pool}` : null;
 buyers.sort((a, b) => b.lastSeen.localeCompare(a.lastSeen) || b.buyCount - a.buyCount || a.wallet.localeCompare(b.wallet));
 return {
  ...empty, status: "available",
  reason: trades.length ? "Wallet behaviour observed in the returned pool sample." : "No trades were returned in this pool sample; this does not establish no trading activity.",
  checkedAt: new Date(checkedTime).toISOString(), source: typeof activity.source === "string" && activity.source.length <= 100 && !/[\u0000-\u001f\u007f]/.test(activity.source) ? activity.source : "Pool trade source",
  sourceUrl: poolUrl, poolUrl,
  sample: { ...empty.sample, start: trades.length ? new Date(trades[0].time).toISOString() : null, end: trades.length ? new Date(trades.at(-1).time).toISOString() : null, tradeCount: trades.length, discardedTrades, duplicateTrades },
  counts: {
   buyers: buyers.length,
   firstSeenRecently: buyers.filter(row => row.flags.newInSample).length,
   repeatBuyers: buyers.filter(row => row.flags.repeat).length,
   netBuyers: netEligible.length ? netEligible.filter(row => row.flags.netBuyer).length : null,
   buyingLower: lowerEligible.length ? lowerEligible.filter(row => row.flags.buyingLower).length : null
  },
  coverage: { netBuyers: netEligible.length, buyingLower: lowerEligible.length },
  wallets: buyers.slice(0, MAX_WALLETS)
 };
}
