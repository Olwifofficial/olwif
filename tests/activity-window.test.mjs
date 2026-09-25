import test from "node:test";
import assert from "node:assert/strict";
import { ACTIVITY_PERIODS, activityWindow } from "../lib/research/activity-window.js";

const TOKEN = `0x${"a".repeat(40)}`;
const POOL = `0x${"b".repeat(40)}`;
const WALLET = `0x${"c".repeat(40)}`;
const CHECKED = "2026-09-24T12:00:00.000Z";
const at = minutes => new Date(Date.parse(CHECKED) - minutes * 60_000).toISOString();
const trade = (id, minutes = 1, side = "buy", volumeUsd = 10) => ({ id, txHash: `tx-${id}`, wallet: WALLET, side, volumeUsd, tokenAmount: 5, priceUsd: 2, timestamp: at(minutes) });
const report = (trades = []) => ({
 target: { chain: "base", address: TOKEN }, generatedAt: CHECKED,
 metrics: {}, research: { market: { pairAddress: POOL, windows: [] }, buyerActivity: { version: 1, status: "available", checkedAt: CHECKED, chain: "base", address: TOKEN, poolAddress: POOL, maxTrades: 300, trades } }
});
const counts = result => ({ buys: result.buys, sells: result.sells, transactions: result.transactions, volumeUsd: result.volumeUsd, priceChangePct: result.priceChangePct });
const unknown = { buys: null, sells: null, transactions: null, volumeUsd: null, priceChangePct: null };

test("supported periods are explicit and unknown selections use the 5 minute default", () => {
 assert.deepEqual(ACTIVITY_PERIODS.map(row => [row.value, row.minutes]), [["1m", 1], ["5m", 5], ["10m", 10], ["15m", 15], ["30m", 30], ["1h", 60], ["6h", 360], ["24h", 1440]]);
 assert.ok(Object.isFrozen(ACTIVITY_PERIODS));
 assert.ok(ACTIVITY_PERIODS.every(Object.isFrozen));
 assert.equal(activityWindow({}, "__proto__").period, "5m");
 assert.equal(activityWindow().period, "5m");
});

test("an exact named indexed window wins without borrowing sample or other window values", () => {
 const raw = report([trade("sample", 1, "sell", 99)]);
 raw.metrics = { buys5m: 50, sells5m: 60, volume5m: 900 };
 raw.research.market.windows = [{ window: "1h", buys: 300, sells: 400 }, { window: "5m", buys: 0, sells: 2, volumeUsd: null, priceChangePct: 1.5 }];
 const result = activityWindow(raw, "5m");
 assert.equal(result.status, "indexed");
 assert.deepEqual(counts(result), { buys: 0, sells: 2, transactions: 2, volumeUsd: null, priceChangePct: 1.5 });
 assert.equal(result.partial, true);
 assert.equal(result.startAt, at(5));
 assert.equal(result.endAt, CHECKED);
 assert.equal(result.checkedAt, CHECKED);
});

test("indexed periods distinguish real zero, missing, invalid and overflow values", () => {
 const raw = report();
 raw.research.market.windows = [{ window: "5m", buys: 0, sells: 0, volumeUsd: 0, priceChangePct: 0 }];
 assert.deepEqual(counts(activityWindow(raw)), { buys: 0, sells: 0, transactions: 0, volumeUsd: 0, priceChangePct: 0 });
 assert.equal(activityWindow(raw).partial, false);
 for (const bad of [null, undefined, "0", false, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
  raw.research.market.windows[0].buys = bad;
  assert.equal(activityWindow(raw).buys, null);
  assert.equal(activityWindow(raw).transactions, null);
 }
 raw.research.market.windows = [{ window: "5m", buys: Number.MAX_SAFE_INTEGER, sells: 1, volumeUsd: Infinity, priceChangePct: -101 }];
 assert.equal(activityWindow(raw).transactions, null);
 assert.equal(activityWindow(raw).volumeUsd, null);
 assert.equal(activityWindow(raw).priceChangePct, null);
});

test("indexed totals cannot contradict their available direction counts", () => {
 const raw = report();
 raw.research.market.windows = [{ window: "5m", buys: 2, sells: 3, transactions: 8 }];
 assert.equal(activityWindow(raw).transactions, null);
 raw.research.market.windows = [{ window: "5m", buys: 4, sells: null, transactions: 3 }];
 assert.equal(activityWindow(raw).transactions, null);
 raw.research.market.windows[0].transactions = 7;
 assert.equal(activityWindow(raw).transactions, 7);
});

test("identical indexed rows deduplicate while conflicting rows cannot win arbitrarily", () => {
 const raw = report();
 const row = { window: "5m", buys: 2, sells: 3, volumeUsd: 40 };
 raw.research.market.windows = [row, { ...row }];
 assert.equal(activityWindow(raw).transactions, 5);
 raw.research.market.windows[1].buys = 7;
 assert.equal(activityWindow(raw).status, "unavailable");
 raw.research.market.windows.reverse();
 assert.equal(activityWindow(raw).status, "unavailable");
});

test("legacy metrics support their own 1h or 5m period and never fabricate shorter periods", () => {
 const raw = { generatedAt: CHECKED, metrics: { buys1h: 20, sells1h: 5, volume1h: 100, priceChange1h: 2, buys5m: 2, sells5m: 1, volume5m: 10 } };
 assert.equal(activityWindow(raw, "1h").transactions, 25);
 assert.equal(activityWindow(raw, "5m").transactions, 3);
 for (const period of ["1m", "10m", "15m", "30m", "6h", "24h"]) {
  const result = activityWindow(raw, period);
  assert.equal(result.status, "unavailable");
  assert.deepEqual(counts(result), unknown);
  assert.match(result.message, /Refresh the report/);
 }
 raw.research = { market: { windows: [{ window: "1h", buys: null, sells: null }] } };
 assert.equal(activityWindow(raw, "1h").status, "unavailable");
});

test("failed market sources exclude indexed data, and source check time anchors valid indexed data", () => {
 const raw = report([trade("sample", 1)]);
 raw.research.market.provider = "DEX Screener";
 raw.research.market.windows = [{ window: "5m", buys: 20, sells: 5 }];
 raw.sources = [{ name: "DEX market", ok: false, checkedAt: CHECKED }];
 assert.equal(activityWindow(raw).status, "sample");
 raw.sources[0] = { name: "DEX market", ok: true, checkedAt: at(1) };
 assert.equal(activityWindow(raw).checkedAt, at(1));
 assert.equal(activityWindow(raw).startAt, at(6));
});

test("sample intervals exclude the lower bound and include the saved check, never future rows", () => {
 const raw = report([trade("before", 10.001), trade("boundary", 10), trade("inside", 9.999), trade("now", 0, "sell", 4), trade("future", -0.001)]);
 const result = activityWindow(raw, "10m");
 assert.equal(result.status, "sample");
 assert.deepEqual(counts(result), { buys: 1, sells: 1, transactions: 2, volumeUsd: 14, priceChangePct: null });
 assert.equal(result.startAt, at(10));
 assert.equal(result.endAt, CHECKED);
 assert.equal(result.partial, true);
 assert.match(result.message, /sample only.*latest 300.*24 hours/);
});

test("each short period uses its own exact saved trade timestamps", () => {
 const raw = report([trade("past", 31), trade("a", 20), trade("b", 12), trade("c", 7), trade("d", 3), trade("e", 0.5)]);
 for (const [period, expected] of [["1m", 1], ["5m", 2], ["10m", 3], ["15m", 4], ["30m", 5]]) {
  const result = activityWindow(raw, period);
  assert.equal(result.transactions, expected);
  assert.equal(result.volumeUsd, expected * 10);
  assert.equal(result.priceChangePct, null);
  assert.equal(result.partial, false);
 }
});

test("the sample is limited to 24 hours and the latest 300 accepted trades", () => {
 const rows = Array.from({ length: 305 }, (_, index) => trade(String(index), 305 - index));
 rows.push(trade("outside", 1440.001));
 const raw = report(rows);
 const day = activityWindow(raw, "24h");
 assert.equal(day.transactions, 300);
 assert.equal(day.volumeUsd, 3000);
 assert.equal(day.partial, true);
 assert.equal(activityWindow(raw, "6h").transactions, 300);
 const exactDay = activityWindow(report([trade("day-boundary", 1440), trade("now", 0)]), "24h");
 assert.equal(exactDay.transactions, 1);
 assert.equal(exactDay.partial, false);
});

test("truncation, late sample start and discarded rows disclose partial coverage", () => {
 const raw = report([trade("older", 10), trade("recent", 0.5)]);
 assert.equal(activityWindow(raw, "1m").partial, false);
 assert.equal(activityWindow(raw, "15m").partial, true);
 raw.research.buyerActivity.truncated = true;
 assert.equal(activityWindow(raw, "1m").partial, true);
 raw.research.buyerActivity.truncated = false;
 raw.research.buyerActivity.rejectedTrades = 1;
 assert.equal(activityWindow(raw, "1m").partial, true);
});

test("missing or invalid selected-trade volume stays unknown and arithmetic overflow is null", () => {
 for (const value of [null, undefined, "5", false, -1, NaN, Infinity]) {
  const result = activityWindow(report([{ ...trade("a", 0.5), volumeUsd: value }]), "1m");
  assert.equal(result.buys, 1);
  assert.equal(result.volumeUsd, null);
 }
 const zero = activityWindow(report([trade("a", 0.5, "sell", 0)]), "1m");
 assert.equal(zero.buys, 0);
 assert.equal(zero.sells, 1);
 assert.equal(zero.volumeUsd, 0);
 assert.equal(activityWindow(report([trade("a", 1, "buy", Number.MAX_VALUE), trade("b", 2, "sell", Number.MAX_VALUE)]), "10m").volumeUsd, null);
 // Missing volume outside the selected period cannot erase usable local data.
 assert.equal(activityWindow(report([trade("old", 10, "buy", null), trade("new", 0.5, "buy", 3)]), "1m").volumeUsd, 3);
});

test("empty, wholly invalid or stale selected-period samples are unknown rather than fabricated zeros", () => {
 for (const rows of [[], [null, {}, false], [{ ...trade("bad"), side: "transfer" }]]) {
  const result = activityWindow(report(rows), "1m");
  assert.equal(result.status, "unavailable");
  assert.deepEqual(counts(result), unknown);
 }
 const result = activityWindow(report([trade("old", 10)]), "1m");
 assert.equal(result.status, "unavailable");
 assert.deepEqual(counts(result), unknown);
 assert.match(result.message, /No recent trade sample covers this period/);
 assert.equal(activityWindow(report([trade("boundary", 1)]), "1m").status, "unavailable");
});

test("identical event IDs count once, conflicting IDs are excluded entirely in either order", () => {
 const row = trade("a", 0.5);
 assert.equal(activityWindow(report([row, { ...row }]), "1m").transactions, 1);
 for (const conflict of [{ ...row, side: "sell" }, { ...row, volumeUsd: 30 }, { ...row, timestamp: "invalid" }, { ...row, txHash: "different" }, { ...row, wallet: `0x${"d".repeat(40)}` }]) {
  for (const rows of [[row, conflict], [conflict, row]]) {
   const result = activityWindow(report([...rows, trade("valid", 0)]), "1m");
   assert.equal(result.transactions, 1);
   assert.equal(result.volumeUsd, 10);
   assert.equal(result.partial, true);
  }
 }
});

test("unsafe wallets, malformed IDs, invalid direction and impossible timestamps cannot count", () => {
 for (const values of [
  { wallet: "javascript:alert(1)" }, { wallet: `${WALLET}/path` }, { wallet: `0x${"0".repeat(40)}` },
  { wallet: `0x${"d".repeat(64)}` }, { id: " bad " }, { id: "bad\n" }, { side: "BUY" },
  { timestamp: "2026-02-30T12:00:00Z" }, { timestamp: "2026-09-24T24:00:00Z" }, { timestamp: "2026-09-24" }
 ]) assert.equal(activityWindow(report([{ ...trade("a", 0), ...values }]), "1m").status, "unavailable");
});

test("chain, token, selected pool and sample version mismatches fail closed", () => {
 for (const change of [
  raw => { raw.target.chain = "__proto__"; }, raw => { raw.target.address = "bad"; },
  raw => { raw.research.buyerActivity.chain = "ethereum"; }, raw => { raw.research.buyerActivity.address = WALLET; },
  raw => { raw.research.buyerActivity.poolAddress = WALLET; }, raw => { delete raw.research.market.pairAddress; },
  raw => { raw.research.buyerActivity.version = 2; }, raw => { raw.research.buyerActivity.status = "unsupported"; }
 ]) {
  const raw = report([trade("a", 0)]); change(raw);
  assert.equal(activityWindow(raw, "1m").status, "unavailable");
  assert.deepEqual(counts(activityWindow(raw, "1m")), unknown);
 }
});

test("EVM identities normalize case and exact 64-hex pool IDs remain usable", () => {
 const raw = report([trade("a", 0.5)]);
 raw.target.address = TOKEN.toUpperCase().replace("0X", "0x");
 raw.research.market.pairAddress = `0x${"bA".repeat(32)}`;
 raw.research.buyerActivity.poolAddress = raw.research.market.pairAddress.toLowerCase();
 assert.equal(activityWindow(raw, "1m").transactions, 1);
});

test("Solana token and pool identities are case-sensitive", () => {
 const mint = "So11111111111111111111111111111111111111112";
 const raw = report([{ ...trade("a", 0), wallet: "Ab" + "1".repeat(30) }]);
 raw.target = { chain: "solana", address: mint };
 Object.assign(raw.research.buyerActivity, { chain: "solana", address: mint, poolAddress: mint });
 raw.research.market.pairAddress = mint;
 assert.equal(activityWindow(raw, "1m").transactions, 1);
 raw.research.buyerActivity.address = mint.replace("S", "s");
 assert.equal(activityWindow(raw, "1m").status, "unavailable");
 raw.research.buyerActivity.address = mint;
 raw.research.buyerActivity.poolAddress = mint.replace("S", "s");
 assert.equal(activityWindow(raw, "1m").status, "unavailable");
});

test("sample check time is strict, historical snapshots stay anchored, and report inconsistencies fail closed", () => {
 for (const value of [null, 123, "", "yesterday", "2026-02-30T12:00:00Z", "2026-09-24T24:00:00Z"]) {
  const raw = report([trade("a", 0)]); raw.research.buyerActivity.checkedAt = value;
  assert.equal(activityWindow(raw, "1m").status, "unavailable");
 }
 const stale = report([trade("a", 0)]); stale.generatedAt = "2026-09-26T12:00:00Z";
 assert.equal(activityWindow(stale, "1m").status, "unavailable");
 const future = report([trade("a", 0)]); future.generatedAt = at(6);
 assert.equal(activityWindow(future, "1m").status, "unavailable");
 const historical = report([trade("a", 0)]);
 historical.generatedAt = "2020-01-01T12:00:00Z";
 historical.research.buyerActivity.checkedAt = "2020-01-01T13:00:00+01:00";
 historical.research.buyerActivity.trades[0].timestamp = "2020-01-01T11:59:30Z";
 const result = activityWindow(historical, "1m");
 assert.equal(result.status, "sample");
 assert.equal(result.checkedAt, "2020-01-01T12:00:00.000Z");
 assert.equal(result.startAt, "2020-01-01T11:59:00.000Z");
 assert.equal(result.transactions, 1);
});

test("malformed inputs remain unavailable and calling the helper never mutates saved evidence", () => {
 for (const raw of [undefined, null, false, {}, { research: null }, { research: { buyerActivity: {} } }]) {
  assert.equal(activityWindow(raw, "10m").status, "unavailable");
 }
 const raw = report([trade("b", 5, "sell"), trade("a", 0)]);
 raw.score = 42;
 raw.momentum = { score: 60 };
 const original = structuredClone(raw);
 const result = activityWindow(raw, "10m");
 result.buys = 1000;
 assert.deepEqual(raw, original);
 assert.equal(activityWindow(raw, "10m").buys, 1);
 assert.equal(Object.hasOwn(result, "score"), false);
});
