import test from "node:test";
import assert from "node:assert/strict";
import { celebrationEligible } from "../lib/research/celebration.js";

const now = Date.parse("2026-09-24T12:00:00.000Z");
const complete = () => ({
  generatedAt: new Date(now).toISOString(), tier: "YELLOW", hardFailCount: 0,
  identity: { name: "Example token", symbol: "EXAMPLE" }, target: { chain: "solana", address: "unrelated-token" },
  momentum: { score: 80 },
  findings: [
    { severity: "good", category: "Authority", title: "Token controls checked" },
    { severity: "good", category: "Authenticity", title: "Project evidence checked" },
    { severity: "good", category: "Distribution", title: "Holder evidence checked" },
  ],
  sources: [{ name: "Solana mint", ok: true }, { name: "RugCheck", ok: true }, { name: "DEX market", ok: true }],
  research: {
    concerns: [], unknowns: [], market: { provider: "DEX Screener", windows: [{ window: "5m", priceChangePct: 6 }, { window: "1h", priceChangePct: 12 }] },
    assessments: [
      { name: "Identity", status: "Verified on-chain" }, { name: "Integrity", status: "Checks passed" },
      { name: "Substance", status: "Verified" }, { name: "Momentum", status: "Strong" }, { name: "Flow quality", status: "Reviewed" },
    ],
  },
});

test("six green lights require all five cards and the overall evidence check", () => {
  assert.equal(celebrationEligible(complete(), now), true);
  for (const category of ["Identity", "Integrity", "Substance", "Flow quality"]) {
    const report = complete();
    report.research.assessments.find(item => item.name === category).status = "Not verified";
    assert.equal(celebrationEligible(report, now), false, category);
  }
  for (const patch of [{ tier: "RED" }, { hardFailCount: 1 }, { findings: [{ severity: "danger", category: "Creator" }] }, { sources: [] }]) {
    assert.equal(celebrationEligible({ ...complete(), ...patch }, now), false);
  }
  const unknowns = complete(); unknowns.research.unknowns.push("Creator ownership is not established");
  assert.equal(celebrationEligible(unknowns, now), false);
});

test("celebration requires exactly one of every expected card", () => {
  for (const mutate of [
    report => report.research.assessments.pop(),
    report => report.research.assessments.push({ name: "Extra", status: "Verified" }),
    report => { report.research.assessments[4] = { ...report.research.assessments[0] }; },
    report => { report.research.assessments = null; },
  ]) {
    const report = complete(); mutate(report);
    assert.equal(celebrationEligible(report, now), false);
  }
});

test("celebration excludes stale, missing and implausibly future-dated snapshots", () => {
  for (const generatedAt of [undefined, "invalid", new Date(now - 15 * 60000 - 1).toISOString(), new Date(now + 60001).toISOString()]) {
    assert.equal(celebrationEligible({ ...complete(), generatedAt }, now), false);
  }
  assert.equal(celebrationEligible({ ...complete(), generatedAt: new Date(now - 15 * 60000).toISOString() }, now), true);
  assert.equal(celebrationEligible(null, now), false);
  assert.equal(celebrationEligible(complete(), NaN), false);
});

test("OLWIF and unrelated projects pass or fail on the same evidence without mutations", () => {
  for (const name of ["OLWIF", "olwif", "O", "Example token", "Competitor token"]) {
    const report = complete(); report.identity = { name, symbol: name }; report.target.address = name;
    const snapshot = structuredClone(report);
    assert.equal(celebrationEligible(report, now), true, name);
    assert.deepEqual(report, snapshot);
    report.research.unknowns.push("Missing evidence");
    assert.equal(celebrationEligible(report, now), false, name);
  }
});

test("the sixth-green celebration follows the displayed price card, not a legacy momentum score", () => {
  for (const windows of [[], [{ window: "5m", priceChangePct: -5 }, { window: "1h", priceChangePct: -10 }], [{ window: "5m", priceChangePct: 0 }, { window: "1h", priceChangePct: 0 }]]) {
    const report = complete(); report.research.market.windows = windows;
    assert.equal(celebrationEligible(report, now), false, "A red/yellow price card cannot trigger confetti");
  }
  const rising = complete(); rising.momentum.score = 20;
  rising.research.assessments.find(item => item.name === "Momentum").status = "Weak";
  assert.equal(celebrationEligible(rising, now), true, "Green observed price direction must match the displayed card");
});
