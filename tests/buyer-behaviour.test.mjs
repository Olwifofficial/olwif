import test from "node:test";
import assert from "node:assert/strict";
import { buyerBehaviour } from "../lib/research/buyer-behaviour.js";

const TOKEN = `0x${"a".repeat(40)}`;
const POOL = `0x${"b".repeat(40)}`;
const A = `0x${"c".repeat(40)}`;
const B = `0x${"d".repeat(40)}`;
const C = `0x${"e".repeat(40)}`;
const CHECKED = "2026-09-24T12:00:00.000Z";
const at = minutes => new Date(Date.parse(CHECKED) - minutes * 60_000).toISOString();
const trade = (id, wallet = A, side = "buy", minutes = 5, tokenAmount = 10, priceUsd = 2) => ({ id, txHash: `tx-${id}`, wallet, side, tokenAmount, priceUsd, volumeUsd: tokenAmount * priceUsd, timestamp: at(minutes) });
const report = (trades = []) => ({
 target: { chain: "base", address: TOKEN }, generatedAt: CHECKED,
 research: { market: { pairAddress: POOL }, buyerActivity: { version: 1, status: "available", checkedAt: CHECKED, chain: "base", address: TOKEN, poolAddress: POOL, poolUrl: "javascript:bad()", source: "GeckoTerminal", sourceUrl: "https://attacker.invalid/", maxTrades: 300, trades } }
});

test("counts distinct, overlapping buyer groups over the entire sample", () => {
 const result = buyerBehaviour(report([
  trade("a1", A, "buy", 20, 20, 5), trade("a2", A, "buy", 5, 10, 4), trade("a3", A, "sell", 3, 5),
  trade("b1", B, "buy", 5, 5), trade("b2", B, "sell", 4, 7), trade("c1", C, "sell", 1)
 ]));
 assert.equal(result.status, "available");
 assert.deepEqual(result.counts, { buyers: 2, firstSeenRecently: 1, repeatBuyers: 1, netBuyers: 1, buyingLower: 1 });
 assert.deepEqual(result.coverage, { netBuyers: 2, buyingLower: 1 });
 const a = result.wallets.find(row => row.wallet === A);
 assert.deepEqual(a.flags, { newInSample: false, repeat: true, netBuyer: true, buyingLower: true });
 assert.equal(a.boughtTokens, 30);
 assert.equal(a.soldTokens, 5);
 assert.equal(a.netTokens, 25);
 assert.equal(a.lowerBuyCount, 1);
 assert.equal(result.sample.start, at(20));
 assert.equal(result.sample.end, at(1));
 assert.equal(result.sample.tradeCount, 6);
 assert.match(result.caveat, /at most 300 trades.*24 hours.*one pool/);
 assert.match(result.caveat, /Groups can overlap/);
});

test("first-seen proxy is anchored at the check, excludes earlier sells and tied sells", () => {
 const result = buyerBehaviour(report([
  trade("a1", A, "sell", 14), trade("a2", A, "buy", 10),
  trade("b1", B, "buy", 15),
  trade("c1", C, "buy", 3), trade("c2", C, "sell", 3)
 ]));
 assert.equal(result.counts.firstSeenRecently, 1);
 assert.equal(result.wallets.find(row => row.wallet === B).flags.newInSample, true);
 assert.equal(result.wallets.find(row => row.wallet === A).flags.newInSample, false);
 assert.equal(result.wallets.find(row => row.wallet === C).flags.newInSample, false);
 assert.match(result.definitions.firstSeenRecently, /15 minutes/);
 assert.match(result.definitions.firstSeenRecently, /does not confirm a new holder or first-ever purchase/);
 assert.equal(buyerBehaviour(report([trade("old", A, "buy", 15.001)])).counts.firstSeenRecently, 0);
});

test("lower buys compare with token-volume-weighted earlier sampled buys, never current price or sells", () => {
 // Before a3, sampled buy VWAP is (100*10 + 1*1) / 101 = 9.91.
 // The sell cannot reset that history, and 9 is lower despite exceeding last buy's 1.
 const raw = report([trade("a1", A, "buy", 10, 100, 10), trade("a2", A, "buy", 9, 1, 1), trade("sell", A, "sell", 8, 101, 100), trade("a3", A, "buy", 5, 1, 9)]);
 raw.metrics = { priceUsd: 999 };
 raw.momentum = { score: 100 };
 const result = buyerBehaviour(raw);
 assert.equal(result.wallets[0].lowerBuyCount, 2);
 assert.equal(result.counts.buyingLower, 1);
 assert.match(result.definitions.buyingLower, /not wallet cost basis or confirmed averaging down/);
 assert.equal(Object.hasOwn(result, "score"), false);
});

test("equal and higher buy prices establish zero lower buyers when fully assessable", () => {
 const result = buyerBehaviour(report([trade("a1", A, "buy", 10, 1, 2), trade("a2", A, "buy", 5, 1, 2), trade("a3", A, "buy", 1, 1, 3)]));
 assert.equal(result.counts.buyingLower, 0);
 assert.equal(result.coverage.buyingLower, 1);
 assert.equal(result.wallets[0].lowerBuyCount, 0);
 assert.equal(result.wallets[0].flags.buyingLower, false);
});

test("same-time buys have no implied ordering, but can together form an earlier baseline", () => {
 const trades = [trade("a1", A, "buy", 10, 1, 10), trade("a2", A, "buy", 10, 1, 2)];
 const first = buyerBehaviour(report(trades));
 assert.equal(first.counts.repeatBuyers, 1);
 assert.equal(first.counts.buyingLower, null);
 assert.equal(first.wallets[0].lowerBuyCount, null);
 assert.equal(first.coverage.buyingLower, 0);
 assert.deepEqual(first, buyerBehaviour(report([...trades].reverse())));
 const withLater = buyerBehaviour(report([...trades, trade("a3", A, "buy", 1, 1, 5)]));
 assert.equal(withLater.wallets[0].lowerBuyCount, 1);
});

test("missing, invalid and coerced token amounts prevent net-token inference", () => {
 for (const value of [null, undefined, "5", false, 0, -1, NaN, Infinity]) {
  const raw = report([trade("a1"), trade("a2", A, "sell", 1)]);
  raw.research.buyerActivity.trades[1].tokenAmount = value;
  const result = buyerBehaviour(raw);
  assert.equal(result.counts.buyers, 1);
  assert.equal(result.counts.netBuyers, null);
  assert.equal(result.coverage.netBuyers, 0);
  assert.equal(result.wallets[0].netTokens, null);
  assert.equal(result.wallets[0].boughtTokens, 10);
  assert.equal(result.wallets[0].soldTokens, null);
  assert.equal(result.wallets[0].flags.netBuyer, null);
 }
});

test("missing buy prices or amounts prevent lower-price inference, never substituted from USD volume", () => {
 for (const field of ["priceUsd", "tokenAmount"]) for (const value of [null, undefined, "5", false, 0, -1, NaN, Infinity]) {
  const rows = [trade("a1", A, "buy", 10, 10, 10), trade("a2", A, "buy", 5, 10, 1)];
  rows[0][field] = value;
  const result = buyerBehaviour(report(rows));
  assert.equal(result.counts.repeatBuyers, 1);
  assert.equal(result.counts.buyingLower, null);
  assert.equal(result.wallets[0].flags.buyingLower, null);
 }
 const raw = report([trade("a1", A, "buy", 10, 1, 10), trade("a2", A, "buy", 5, null, 1)]);
 assert.equal(buyerBehaviour(raw).counts.buyingLower, null);
});

test("partial price coverage retains demonstrated lower buys but does not imply a zero", () => {
 const knownLower = report([trade("a1", A, "buy", 10, 1, 10), trade("a2", A, "buy", 5, 1, 9), trade("a3", A, "buy", 1, 1, null)]);
 assert.equal(buyerBehaviour(knownLower).counts.buyingLower, 1);
 const uncertain = structuredClone(knownLower);
 uncertain.research.buyerActivity.trades[1].priceUsd = 11;
 const result = buyerBehaviour(uncertain);
 assert.equal(result.wallets[0].lowerBuyCount, 0);
 assert.equal(result.wallets[0].flags.buyingLower, null);
 assert.equal(result.counts.buyingLower, null);
});

test("eligible denominators disclose partial wallet amount and price coverage", () => {
 const result = buyerBehaviour(report([trade("a1", A, "buy", 10, 5, 1), trade("a2", A, "buy", 5, 5, 2), trade("b1", B, "buy", 1, null, null)]));
 assert.equal(result.counts.buyers, 2);
 assert.equal(result.counts.netBuyers, 1);
 assert.equal(result.counts.buyingLower, 0);
 assert.deepEqual(result.coverage, { netBuyers: 1, buyingLower: 1 });
});

test("identical duplicate IDs are counted once and conflicting IDs are entirely excluded", () => {
 const row = trade("a1");
 const identical = buyerBehaviour(report([row, structuredClone(row), trade("a2", B)]));
 assert.equal(identical.sample.tradeCount, 2);
 assert.equal(identical.sample.duplicateTrades, 1);
 assert.equal(identical.counts.repeatBuyers, 0);
 for (const conflict of [{ ...row, wallet: B }, { ...row, priceUsd: 3 }, { ...row, side: "sell" }, { ...row, timestamp: "bad" }, { ...row, txHash: "another-transaction" }]) {
  const result = buyerBehaviour(report([row, conflict, trade("other", C)]));
  assert.equal(result.sample.tradeCount, 1);
  assert.equal(result.sample.discardedTrades, 2);
  assert.equal(result.wallets[0].wallet, C);
 }
 const reversed = buyerBehaviour(report([{ ...row, timestamp: "bad" }, row, trade("other", C)]));
 assert.equal(reversed.sample.tradeCount, 1);
});

test("EVM token, pool and wallet addresses match without case sensitivity", () => {
 const raw = report([trade("a1", A), trade("a2", `0x${"C".repeat(40)}`)]);
 raw.target.address = `0x${"A".repeat(40)}`;
 raw.research.market.pairAddress = `0x${"B".repeat(40)}`;
 const result = buyerBehaviour(raw);
 assert.equal(result.status, "available");
 assert.equal(result.counts.buyers, 1);
 assert.equal(result.counts.repeatBuyers, 1);
 assert.equal(result.wallets[0].url, `https://basescan.org/address/${A}`);
});

test("64-hex Uniswap v4 pool identities match independently of wallet-address validation", () => {
 const raw = report([trade("a1")]);
 const quantaPool = "0x" + "bA".repeat(32);
 raw.research.market.pairAddress = quantaPool;
 raw.research.buyerActivity.poolAddress = quantaPool.toLowerCase();
 const result = buyerBehaviour(raw);
 assert.equal(result.status, "available");
 assert.equal(result.poolUrl, `https://www.geckoterminal.com/base/pools/${quantaPool.toLowerCase()}`);
 assert.equal(buyerBehaviour(report([trade("not-a-wallet", quantaPool)])).status, "unavailable");
 raw.research.buyerActivity.poolAddress = `0x${"b".repeat(63)}`;
 assert.equal(buyerBehaviour(raw).status, "unavailable");
});

test("Solana addresses and wallets retain case sensitivity", () => {
 const mint = "So11111111111111111111111111111111111111112";
 const wallet = "Ab" + "1".repeat(30), other = "ab" + "1".repeat(30);
 const raw = report([trade("a1", wallet), trade("a2", other)]);
 raw.target = { chain: "solana", address: mint };
 raw.research.buyerActivity.chain = "solana";
 raw.research.buyerActivity.address = mint;
 raw.research.buyerActivity.poolAddress = mint;
 raw.research.market.pairAddress = mint;
 const result = buyerBehaviour(raw);
 assert.equal(result.counts.buyers, 2);
 assert.equal(result.counts.repeatBuyers, 0);
 assert.ok(result.wallets.every(row => row.url === `https://solscan.io/address/${row.wallet}`));
 raw.research.buyerActivity.address = mint.replace("S", "s");
 assert.equal(buyerBehaviour(raw).status, "unavailable");
});

test("all wallet and pool links are built from validated identities, not supplied URLs", () => {
 const raw = report([trade("a1")]);
 raw.research.buyerActivity.trades[0].url = "javascript:alert(1)";
 const result = buyerBehaviour(raw);
 assert.equal(result.wallets[0].url, `https://basescan.org/address/${A}`);
 assert.equal(result.poolUrl, `https://www.geckoterminal.com/base/pools/${POOL}`);
 assert.equal(result.sourceUrl, result.poolUrl);
 for (const wallet of ["javascript:alert(1)", `${A}/../../path`, `${A}?a=1`, `${A} `, "0x1234", "__proto__", `0x${"0".repeat(40)}`]) {
  assert.equal(buyerBehaviour(report([trade("bad", wallet)])).status, "unavailable");
 }
});

test("token, chain, pool and unsupported formats fail closed", () => {
 for (const modify of [
  raw => { raw.research.buyerActivity.address = A; },
  raw => { raw.research.buyerActivity.chain = "ethereum"; },
  raw => { raw.research.buyerActivity.poolAddress = A; },
  raw => { delete raw.research.market.pairAddress; },
  raw => { raw.target.address = "bad"; },
  raw => { raw.target.chain = "__proto__"; },
  raw => { raw.research.buyerActivity.version = 2; }
 ]) {
  const raw = report([trade("a1")]); modify(raw);
  const result = buyerBehaviour(raw);
  assert.equal(result.status, "unavailable");
  assert.equal(result.counts.buyers, null);
  assert.deepEqual(result.wallets, []);
 }
});

test("unavailable and unsupported sources never turn missing evidence into zeros", () => {
 for (const status of ["unavailable", "unsupported", "invalid", null]) {
  const raw = report([trade("a1")]); raw.research.buyerActivity.status = status;
  const result = buyerBehaviour(raw);
  assert.equal(result.status, status === "unsupported" ? "unsupported" : "unavailable");
  assert.ok(Object.values(result.counts).every(value => value === null));
  assert.equal(result.wallets.length, 0);
 }
 for (const raw of [undefined, null, {}, { research: {} }, { target: null }, { research: { buyerActivity: false } }]) {
  assert.equal(buyerBehaviour(raw).status, "unavailable");
 }
});

test("empty returned samples show zero observed buyers without claiming no trading", () => {
 const result = buyerBehaviour(report());
 assert.equal(result.status, "available");
 assert.equal(result.counts.buyers, 0);
 assert.equal(result.counts.firstSeenRecently, 0);
 assert.equal(result.counts.repeatBuyers, 0);
 assert.equal(result.counts.netBuyers, null);
 assert.equal(result.counts.buyingLower, null);
 assert.equal(result.sample.start, null);
 assert.match(result.reason, /does not establish no trading activity/);
 const sells = buyerBehaviour(report([trade("s1", A, "sell")]));
 assert.equal(sells.counts.buyers, 0);
 assert.equal(sells.counts.netBuyers, null);
 assert.deepEqual(sells.wallets, []);
});

test("rows contain buying wallets ordered by most recent observed activity", () => {
 const result = buyerBehaviour(report([
  trade("a1", A, "buy", 10), trade("a2", A, "buy", 8),
  trade("b1", B, "buy", 1), trade("c1", C, "sell", 0)
 ]));
 assert.deepEqual(result.wallets.map(row => row.wallet), [B, A]);
 assert.equal(result.sample.tradeCount, 4);
 assert.equal(result.counts.buyers, 2);
});

test("safe collector rejection and duplicate totals remain visible", () => {
 const raw = report([trade("a1"), trade("a1"), null]);
 raw.research.buyerActivity.rejectedTrades = 7;
 raw.research.buyerActivity.duplicateTrades = 3;
 const result = buyerBehaviour(raw);
 assert.equal(result.sample.discardedTrades, 8);
 assert.equal(result.sample.duplicateTrades, 4);
 for (const invalid of [-1, 1.5, "7", null, NaN, Infinity]) {
  raw.research.buyerActivity.rejectedTrades = invalid;
  raw.research.buyerActivity.duplicateTrades = invalid;
  assert.equal(buyerBehaviour(raw).sample.discardedTrades, 1);
  assert.equal(buyerBehaviour(raw).sample.duplicateTrades, 1);
 }
});

test("nonempty malformed samples stay unavailable, while valid rows survive rejected records", () => {
 const invalid = [null, {}, false, { id: "bad", wallet: A, side: "buy", timestamp: "invalid" }];
 assert.equal(buyerBehaviour(report(invalid)).status, "unavailable");
 const result = buyerBehaviour(report([...invalid, trade("a1")]));
 assert.equal(result.status, "available");
 assert.equal(result.sample.tradeCount, 1);
 assert.equal(result.sample.discardedTrades, 4);
 const noList = report(); noList.research.buyerActivity.trades = {};
 assert.equal(buyerBehaviour(noList).status, "unavailable");
});

test("only trades within the preceding 24 hours and not after the check enter the sample", () => {
 const result = buyerBehaviour(report([trade("boundary", A, "buy", 1440), trade("old", A, "buy", 1440.01), trade("future", B, "buy", -0.01), trade("now", C, "buy", 0)]));
 assert.equal(result.sample.tradeCount, 2);
 assert.equal(result.sample.discardedTrades, 2);
 assert.equal(result.sample.start, at(1440));
 assert.equal(result.sample.end, CHECKED);
 assert.equal(result.counts.buyers, 2);
});

test("invalid, impossible and stale timestamps are rejected without consulting a live clock", () => {
 for (const value of [null, 123, "", "yesterday", "2026-02-30T12:00:00Z", "2026-09-24T24:00:00Z"]) {
  const raw = report([trade("a1")]); raw.research.buyerActivity.checkedAt = value;
  assert.equal(buyerBehaviour(raw).status, "unavailable");
 }
 const stale = report([trade("a1")]); stale.generatedAt = "2026-09-26T12:00:00Z";
 assert.equal(buyerBehaviour(stale).status, "unavailable");
 const inconsistent = report([trade("a1")]); inconsistent.generatedAt = at(6);
 assert.equal(buyerBehaviour(inconsistent).status, "unavailable");
 const historical = report([trade("a1")]);
 historical.generatedAt = "2020-01-01T12:00:00Z";
 historical.research.buyerActivity.checkedAt = "2020-01-01T12:00:00Z";
 historical.research.buyerActivity.trades[0].timestamp = "2020-01-01T11:55:00Z";
 assert.equal(buyerBehaviour(historical).status, "available");
 assert.equal(buyerBehaviour(historical).counts.firstSeenRecently, 1);
});

test("wallet rows are capped at 20 while counts cover the latest 300 valid trades", () => {
 const rows = Array.from({ length: 305 }, (_, index) => trade(String(index), `0x${(index + 1).toString(16).padStart(40, "0")}`, "buy", 305 - index));
 rows.push(trade("active-2", rows.at(-1).wallet, "buy", 0));
 const result = buyerBehaviour(report(rows));
 assert.equal(result.sample.tradeCount, 300);
 assert.equal(result.sample.discardedTrades, 6);
 assert.equal(result.counts.buyers, 299);
 assert.equal(result.wallets.length, 20);
 assert.equal(result.wallets[0].buyCount, 2);
 assert.equal(result.wallets[0].wallet, rows.at(-1).wallet);
 assert.equal(result.sample.start, at(299));
});

test("arithmetic overflow remains unknown rather than exposing nonfinite totals", () => {
 const result = buyerBehaviour(report([trade("a1", A, "buy", 10, Number.MAX_VALUE, 2), trade("a2", A, "buy", 5, Number.MAX_VALUE, 1)]));
 assert.equal(result.wallets[0].boughtTokens, null);
 assert.equal(result.wallets[0].netTokens, null);
 assert.equal(result.counts.netBuyers, null);
 assert.equal(result.counts.buyingLower, null);
});

test("never mutates evidence or shares mutable result definitions between calls", () => {
 const raw = report([trade("b1", B), trade("a1", A, "buy", 20), trade("a2", A)]);
 const before = structuredClone(raw);
 const result = buyerBehaviour(raw);
 assert.deepEqual(raw, before);
 result.definitions.buyers = "modified";
 result.wallets[0].flags.repeat = false;
 assert.deepEqual(raw, before);
 assert.notEqual(buyerBehaviour(raw).definitions.buyers, "modified");
});
