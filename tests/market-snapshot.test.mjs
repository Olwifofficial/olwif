import test from "node:test";
import assert from "node:assert/strict";
import { marketSnapshot } from "../lib/research/market-snapshot.js";

const report = (...windows) => ({ metrics: { marketCap: 123456, priceUsd: 0.000123, fdv: 999999 }, research: { market: { windows: windows.map(([window, priceChangePct]) => ({ window, priceChangePct })) } } });
const trend = (...windows) => marketSnapshot(report(...windows)).trend;

test("uses market cap and price only, never substitutes FDV or coerces invalid amounts", () => {
 assert.equal(marketSnapshot(report()).marketCapUsd, 123456);
 assert.equal(marketSnapshot(report()).priceUsd, 0.000123);
 assert.equal(marketSnapshot({ metrics: { fdv: 999 } }).marketCapUsd, null);
 for (const value of [null, undefined, "42", "", false, -1, NaN, Infinity]) {
  const result = marketSnapshot({ metrics: { marketCap: value, priceUsd: value } });
  assert.equal(result.marketCapUsd, null);
  assert.equal(result.priceUsd, null);
 }
 assert.equal(marketSnapshot({ metrics: { marketCap: 0, priceUsd: 0 } }).marketCapUsd, 0);
 assert.equal(marketSnapshot({ metrics: { marketCap: 0, priceUsd: 0 } }).priceUsd, 0);
});

test("running up uses the exact declared short-window thresholds", () => {
 const result = trend(["5m", 5], ["1h", 10]);
 assert.equal(result.label, "Running up");
 assert.equal(result.tone, "up");
 assert.match(result.detail, /at least \+5% over 5 minutes and \+10% over 1 hour/);
 assert.match(result.detail, /Recorded changes: 5m: \+5% · 1h: \+10%/);
 assert.equal(trend(["5m", 4.999], ["1h", 10]).label, "Rising");
 assert.equal(trend(["5m", 5], ["1h", 9.999]).label, "Rising");
});

test("consistent gains and losses use observed direction, not original scores", () => {
 const raw = report(["5m", -2], ["1h", -3]);
 raw.momentum = { score: 100, label: "Strong" };
 assert.equal(marketSnapshot(raw).trend.label, "Falling");
 assert.equal(trend(["5m", 2], ["1h", 3]).label, "Rising");
 assert.equal(trend(["5m", -2], ["1h", -3]).tone, "down");
});

test("flat endpoints do not claim a consolidation chart pattern", () => {
 const result = trend(["5m", 0], ["1h", 1], ["6h", -1]);
 assert.equal(result.label, "Little net change");
 assert.equal(result.tone, "neutral");
 assert.match(result.detail, /within ±1%/);
 assert.match(result.detail, /do not establish consolidation/);
 assert.match(result.detail, /may still have moved sharply/);
});

test("opposite short and long windows remain qualified", () => {
 assert.equal(trend(["5m", -2], ["1h", 8]).label, "Pulling back");
 assert.equal(trend(["5m", 2], ["1h", -8]).label, "Mixed direction");
 assert.equal(trend(["5m", 6], ["1h", 12], ["24h", -30]).label, "Mixed direction");
 assert.equal(trend(["5m", -6], ["1h", -12], ["24h", 30]).label, "Pulling back");
 assert.equal(trend(["5m", 0], ["1h", 3]).label, "Mixed direction");
});

test("single usable window is explicitly named and missing windows are not zero", () => {
 assert.equal(trend(["1h", 5], ["5m", null]).label, "Rising (1h)");
 assert.equal(trend(["24h", -2]).label, "Falling (24h)");
 assert.equal(trend(["6h", 0]).label, "Little net change (6h)");
 assert.equal(trend(["6h", 5], ["24h", 8]).label, "Snapshot incomplete");
 assert.equal(trend(["5m", null], ["1h", undefined]).label, "Trend unavailable");
});

test("only known windows appear, sorted chronologically without mutating evidence", () => {
 const raw = report(["24h", 20], ["unverified", 500], ["1h", 15], ["5m", 6], ["6h", 18]);
 const before = structuredClone(raw);
 const result = marketSnapshot(raw);
 assert.deepEqual(result.trend.windows.map(row => row.window), ["5m", "1h", "6h", "24h"]);
 assert.deepEqual(raw, before);
 assert.equal(trend(["__proto__", 3], ["constructor", 4]).label, "Trend unavailable");
});

test("minus 100 percent is valid while impossible, nonfinite and coercible changes are not", () => {
 assert.equal(trend(["5m", -100], ["1h", -100]).label, "Falling");
 for (const value of [-100.01, NaN, Infinity, "5", false, ""]) {
  const result = trend(["5m", value], ["1h", 100]);
  assert.equal(result.label, "Snapshot incomplete");
  assert.equal(result.tone, "unknown");
  assert.deepEqual(result.windows, [{ window: "1h", priceChangePct: 100 }]);
 }
});

test("conflicting or invalid duplicate windows cannot yield an optimistic state", () => {
 for (const pair of [[5, 6], [5, null], [null, 5], [5, "5"], ["5", 5], [5, NaN]]) {
  const result = trend(["5m", pair[0]], ["1h", 100], ["5m", pair[1]]);
  assert.equal(result.label, "Snapshot incomplete");
  assert.equal(result.tone, "unknown");
  assert.equal(result.windows.some(row => row.window === "5m"), false);
 }
 assert.equal(trend(["5m", 5], ["5m", 5], ["1h", 10]).label, "Running up");
});

test("recorded source disagreement overrides even strong positive changes", () => {
 const raw = report(["5m", 20], ["1h", 100]);
 raw.findings = [{ code: "MARKET_SOURCE_DISAGREEMENT", severity: "warn" }];
 const result = marketSnapshot(raw);
 assert.equal(result.trend.label, "Snapshot incomplete");
 assert.equal(result.trend.tone, "unknown");
 assert.match(result.trend.detail, /prices disagree/);
 assert.equal(result.marketCapUsd, 123456);
});

test("failed selected source cannot support a direction; unrelated failure does not erase data", () => {
 const raw = report(["5m", 20], ["1h", 100]);
 raw.research.market.provider = "DEX Screener";
 raw.sources = [{ name: "DEX market", ok: false }];
 assert.equal(marketSnapshot(raw).trend.tone, "unknown");
 raw.sources = [{ name: "DEX market", ok: true }, { name: "GeckoTerminal market", ok: false }];
 assert.equal(marketSnapshot(raw).trend.label, "Running up");
 raw.research.market.provider = "GeckoTerminal";
 assert.equal(marketSnapshot(raw).trend.tone, "unknown");
});

test("empty, null and malformed reports remain safely unknown", () => {
 for (const raw of [undefined, null, {}, { research: { market: { windows: {} } } }, { research: { market: { windows: [null, false, {}, { window: "5m" }] } } }]) {
  const result = marketSnapshot(raw);
  assert.equal(result.trend.label, "Trend unavailable");
  assert.equal(result.trend.tone, "unknown");
  assert.deepEqual(result.trend.windows, []);
 }
});
