import { buyerBehaviour } from "./buyer-behaviour.js";
import { explorerLink } from "./research-report.js";

export const ACTIVITY_PERIODS = Object.freeze([
 { value: "1m", label: "1 min", minutes: 1 },
 { value: "5m", label: "5 min", minutes: 5 },
 { value: "10m", label: "10 min", minutes: 10 },
 { value: "15m", label: "15 min", minutes: 15 },
 { value: "30m", label: "30 min", minutes: 30 },
 { value: "1h", label: "1 hour", minutes: 60 },
 { value: "6h", label: "6 hours", minutes: 360 },
 { value: "24h", label: "24 hours", minutes: 1440 }
].map(period => Object.freeze(period)));

const INDEXED_PERIODS = new Set(["5m", "1h", "6h", "24h"]);
const MAX_TRADES = 300;
const DAY = 24 * 60 * 60 * 1000;
const amount = value => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const positive = value => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const change = value => typeof value === "number" && Number.isFinite(value) && value >= -100 ? value : null;

function timestamp(value) {
 if (typeof value !== "string") return null;
 const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
 if (!match || +match[4] > 23 || +match[5] > 59 || +match[6] > 59) return null;
 const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
 if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value.slice(0, 10)) return null;
 const time = Date.parse(value);
 return Number.isFinite(time) ? time : null;
}

function windowValues(row) {
 const buys = count(row?.buys), sells = count(row?.sells);
 const suppliedTotal = count(row?.transactions);
 const sum = buys !== null && sells !== null ? count(buys + sells) : null;
 // A supplied total must agree with known component counts. Missing totals can
 // be added from buys and sells in this same indexed window, never another one.
 const transactions = buys !== null && sells !== null
  ? suppliedTotal !== null && suppliedTotal !== sum ? null : sum
  : suppliedTotal !== null && suppliedTotal >= (buys ?? 0) + (sells ?? 0) ? suppliedTotal : null;
 return { buys, sells, volumeUsd: amount(row?.volumeUsd), transactions, priceChangePct: change(row?.priceChangePct) };
}

function indexedWindow(report, period) {
 if (!INDEXED_PERIODS.has(period)) return null;
 const market = report.research?.market;
 const sourceName = market?.provider === "DEX Screener" ? "DEX market" : market?.provider === "GeckoTerminal" ? "GeckoTerminal market" : null;
 const sources = (Array.isArray(report.sources) ? report.sources : []).filter(row => sourceName && row?.name === sourceName);
 if (sources.length && !sources.some(row => row.ok === true)) return null;
 const rows = (Array.isArray(market?.windows) ? market.windows : []).filter(row => row?.window === period);
 let values;
 if (rows.length) {
  const normalized = rows.map(windowValues);
  // Repeated identical records are harmless; disagreeing records cannot select
  // an arbitrary winner or be filled from a different source.
  if (normalized.some(row => JSON.stringify(row) !== JSON.stringify(normalized[0]))) return null;
  values = normalized[0];
 } else if (period === "1h" || period === "5m") {
  const metrics = report.metrics;
  values = windowValues({ buys: metrics?.[`buys${period}`], sells: metrics?.[`sells${period}`], volumeUsd: metrics?.[`volume${period}`], priceChangePct: metrics?.[`priceChange${period}`] });
 } else return null;
 if (Object.values(values).every(value => value === null)) return null;
 const sourceTime = sources.filter(row => row.ok === true).map(row => timestamp(row.checkedAt)).find(value => value !== null);
 const checkedTime = sourceTime ?? timestamp(report.research?.freshness?.fetchedAt) ?? timestamp(report.generatedAt);
 return { ...values, checkedTime };
}

function sampleTrades(activity, chain, checkedTime) {
 const ids = new Map(), rejected = new Set();
 for (const raw of activity.trades) {
  const id = typeof raw?.id === "string" && raw.id.length > 0 && raw.id.length <= 256 && raw.id.trim() === raw.id && !/[\u0000-\u001f\u007f]/.test(raw.id) ? raw.id : null;
  const wallet = typeof raw?.wallet === "string" && explorerLink(chain, raw.wallet) ? chain === "solana" ? raw.wallet : raw.wallet.toLowerCase() : null;
  const time = timestamp(raw?.timestamp);
  const valid = id && wallet && !(chain !== "solana" && /^0x0{40}$/.test(wallet)) && (raw.side === "buy" || raw.side === "sell") && time !== null && time <= checkedTime && time >= checkedTime - DAY;
  const txHash = typeof raw?.txHash === "string" ? chain === "solana" ? raw.txHash : raw.txHash.toLowerCase() : null;
  const trade = valid ? { id, txHash, wallet, time, side: raw.side, tokenAmount: positive(raw.tokenAmount), priceUsd: positive(raw.priceUsd), volumeUsd: amount(raw.volumeUsd) } : null;
  if (!id || rejected.has(id)) continue;
  if (ids.has(id)) {
   if (!trade || JSON.stringify(ids.get(id)) !== JSON.stringify(trade)) { ids.delete(id); rejected.add(id); }
   continue;
  }
  if (!trade) { rejected.add(id); continue; }
  ids.set(id, trade);
 }
 return [...ids.values()].sort((a, b) => a.time - b.time || a.id.localeCompare(b.id)).slice(-MAX_TRADES);
}

/** Presentation of one saved period; no fetching, live clock, or score changes. */
export function activityWindow(input = {}, period = "5m") {
 const report = input && typeof input === "object" ? input : {};
 const selected = ACTIVITY_PERIODS.find(row => row.value === period) || ACTIVITY_PERIODS[1];
 const duration = selected.minutes * 60 * 1000;
 const empty = {
  period: selected.value, label: selected.label,
  buys: null, sells: null, volumeUsd: null, transactions: null, priceChangePct: null,
  status: "unavailable", partial: true, checkedAt: null, startAt: null, endAt: null,
  message: "This period has no saved trading data. Refresh the report to request a new trade sample."
 };
 const bounds = checkedTime => checkedTime === null ? {} : {
  checkedAt: new Date(checkedTime).toISOString(),
  startAt: new Date(checkedTime - duration).toISOString(), endAt: new Date(checkedTime).toISOString()
 };
 const indexed = indexedWindow(report, selected.value);
 if (indexed) {
  const { checkedTime, ...values } = indexed;
  const partial = Object.values(values).some(value => value === null);
  return { ...empty, ...values, ...bounds(checkedTime), status: "indexed", partial,
   message: `Saved indexed ${selected.label} snapshot for the selected pool.${partial ? " Missing figures are unknown." : ""} Provider indexing delay and activity in other pools are unknown.` };
 }

 // This shared presentation helper validates the saved chain, exact token,
 // selected pool (including v4 IDs), format and report/check time consistency.
 const validation = buyerBehaviour(report);
 if (validation.status !== "available") return { ...empty, message: `${validation.reason} Refresh the report to request a new trade sample.` };
 const activity = report.research.buyerActivity;
 const checkedTime = timestamp(validation.checkedAt);
 const trades = sampleTrades(activity, report.target.chain, checkedTime);
 if (!trades.length) return { ...empty, ...bounds(checkedTime), message: "No usable trades were returned in this saved pool sample. Trading activity for this period is unknown; refresh the report to request a new sample." };
 const start = checkedTime - duration;
 const rows = trades.filter(trade => trade.time > start && trade.time <= checkedTime);
 if (!rows.length) return { ...empty, ...bounds(checkedTime), message: "No recent trade sample covers this period. Trading activity is unknown; refresh the report to request a new sample." };
 const truncated = activity.truncated === true || trades.length >= MAX_TRADES;
 const partial = trades[0].time > start || truncated || validation.sample.discardedTrades > 0;
 // Counts describe returned trades only. An empty selected-period subset above
 // cannot establish zero activity when provider indexing freshness is unknown.
 const buys = rows.filter(row => row.side === "buy").length, sells = rows.filter(row => row.side === "sell").length;
 const summed = rows.some(row => row.volumeUsd === null) ? null : rows.reduce((total, row) => total + row.volumeUsd, 0);
 const volumeUsd = amount(summed);
 return { ...empty, ...bounds(checkedTime), status: "sample", partial,
  buys, sells, volumeUsd, transactions: rows.length,
  message: `Saved trade sample only: at most the latest 300 trades from 24 hours in the selected pool.${partial ? " This period has partial coverage." : ""}${volumeUsd === null ? " Sample volume is unknown." : ""} Counts do not establish all trading activity; indexing delay and other pools are unknown.` };
}
