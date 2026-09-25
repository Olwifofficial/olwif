import test from "node:test";
import assert from "node:assert/strict";
import { reportProsCons } from "../lib/research/pros-cons.js";

const finding = (code, title, detail, severity = "good", hardFail = false) => ({ code, title, detail, severity, hardFail });
const report = findings => ({ findings, research: {
  strengths: findings.filter(row => row.severity === "good").map(row => `${row.title}: ${row.detail}`),
  concerns: findings.filter(row => ["danger", "warn"].includes(row.severity)).map(row => `${row.title}: ${row.detail}`)
} });
const agentFindings = () => [
  finding("MINT_AUTHORITY_REVOKED", "Mint authority revoked", "The parsed mint account reports no active mint authority."),
  finding("FREEZE_AUTHORITY_REVOKED", "Freeze authority revoked", "The parsed mint account reports no active freeze authority."),
  finding("RUGCHECK_NO_LISTED_RISKS", "No RugCheck warnings returned", "This is a useful signal, not a guarantee that the creator or market is safe."),
  finding("SOL_TOP_HOLDER_MODERATE", "No exposed holder above 5%", "Largest non-market balance in the RugCheck snapshot: 3.01%."),
  finding("LP_LOCKED", "Liquidity lock reported", "The lowest reported pool lock is 100.00%."),
  finding("LIQUIDITY_VISIBLE", "Liquidity is visible", "Approximately $58,113 is reported in the strongest indexed pool."),
  finding("TOKEN_EXTENSIONS", "Token extensions require review", "Detected: metadataPointer, tokenMetadata.", "warn"),
  finding("INSIDER_GRAPH", "Linked insider network detected", "RugCheck reported 1 insider network(s).", "danger")
];

test("condenses the selected report to factual short bullets, excluding absence-of-warning praise", () => {
  const result = reportProsCons(report(agentFindings()));
  assert.deepEqual(result.pros.map(row => row.text), [
    "Mint and freeze authorities revoked.",
    "Largest returned non-market balance: 3.01% (snapshot only).",
    "Lowest reported pool lock: 100.00%.", "Largest indexed pool: about $58,113 liquidity."
  ]);
  assert.deepEqual(result.cons.map(row => row.text), ["1 possible insider network flagged; links unverified.", "Metadata extensions need review."]);
  assert.equal(result.cons[0].severity, "danger");
  assert.equal(result.cons[0].code, "INSIDER_GRAPH");
});

test("combines authority bullets only when both exact positive findings exist", () => {
  const findings = agentFindings().slice(0, 2);
  assert.equal(reportProsCons(report(findings.slice(0, 1))).pros[0].text, "Mint authority revoked.");
  assert.equal(reportProsCons(report(findings.slice(1))).pros[0].text, "Freeze authority revoked.");
  findings[1].detail = "The parsed result is not confirmed; it may be stale.";
  assert.equal(reportProsCons(report(findings)).pros.length, 2);
});

test("all serious findings survive, serious-first, with exact severity and hard-fail state", () => {
  const findings = [finding("WARN", "Review this", "Needs inspection", "warn"), ...Array.from({ length: 7 }, (_, i) => finding(`DANGER_${i}`, `Danger ${i}`, "A possible restriction, not proven", "danger")), finding("HARD", "Hard flag", "Reported restriction", "warn", true)];
  const result = reportProsCons(report(findings));
  assert.equal(result.cons.length, 9);
  assert.equal(result.cons[0].code, "HARD");
  assert.equal(result.cons[0].hardFail, true);
  assert.equal(result.cons[0].severity, "warn");
  assert.equal(result.cons.at(-1).code, "WARN");
  assert.deepEqual(result.pros, []);
});

test("numbers are read from recorded finding evidence, not newer or conflicting metrics", () => {
  const raw = report(agentFindings());
  raw.metrics = { lpLockedPct: 0, topHolderPct: 42, liquidityUsd: 7, insiderPercentage: 99 };
  assert.match(reportProsCons(raw).pros.map(row => row.text).join("\n"), /3\.01%[\s\S]+100\.00%[\s\S]+58,113/);
  const zero = reportProsCons(report([
    finding("LP_UNLOCKED", "Material liquidity appears unlocked", "The lowest reported pool lock is 0.00%.", "danger", true),
    finding("LIQUIDITY_CRITICAL", "Extremely thin liquidity", "Only about $0 of liquidity is visible. Exits can become impossible or extremely expensive.", "danger", true)
  ]));
  assert.equal(zero.cons[0].text, "Lowest reported pool lock: 0.00%.");
  assert.equal(zero.cons[1].text, "Only about $0 liquidity; selling may be impossible or costly.");
});

test("unknown/custom prose preserves negation and qualifications instead of unsafe truncation", () => {
  const custom = finding("LP_LOCKED", "Liquidity lock reported", "The lock is not verified; a conflicting pool may have no lock.");
  const external = finding("RUGCHECK_CUSTOM", "Possible team match", "This may be another person; no affiliation has been established.", "warn");
  const result = reportProsCons(report([custom, external]));
  assert.equal(result.pros[0].text, `${custom.title}: ${custom.detail}`);
  assert.equal(result.cons[0].text, `${external.title}: ${external.detail}`);
});

test("cached narrative-only strengths and concerns remain verbatim without duplication", () => {
  const raw = report(agentFindings());
  raw.research.concerns.push("Reported repository example/repo is archived. Verify whether development moved elsewhere.");
  raw.research.concerns.push(raw.research.concerns.at(-1));
  raw.research.strengths.push("Product documentation is available, but its claims have not been checked.");
  const result = reportProsCons(raw);
  assert.equal(result.cons.length, 3);
  assert.equal(result.cons.at(-1).text, raw.research.concerns.at(-1));
  assert.equal(result.pros.at(-1).text, raw.research.strengths.at(-1));
  assert.deepEqual(reportProsCons({ research: { strengths: ["No RugCheck warnings returned: This is not a safety guarantee."], concerns: ["No source evidence, not a proven scam."] } }).pros, []);
});

test("unverified rug and insider flags stay explicitly unverified", () => {
  const result = reportProsCons(report([
    finding("RUGCHECK_RUGGED", "Token is marked rugged", "RugCheck's current report marks this mint as rugged.", "danger", true),
    finding("INSIDER_SUPPLY_HIGH", "High insider concentration", "Approximately 17.25% is attributed to insiders.", "danger", true),
    finding("INSIDER_GRAPH", "Linked insider network detected", "RugCheck reported one or more insider network(s).", "danger")
  ]));
  assert.equal(result.cons[0].text, "Possible rug pull flagged; not independently proven.");
  assert.equal(result.cons[1].text, "About 17.25% attributed to possible insiders; ownership unverified.");
  assert.equal(result.cons[2].text, "One or more possible insider networks flagged; links unverified.");
});

test("does not mutate frozen reports, recalculate scores or turn missing evidence into a pro", () => {
  const raw = report(agentFindings());
  raw.riskScore = 76;
  const before = JSON.stringify(raw);
  const freeze = value => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } };
  freeze(raw);
  reportProsCons(raw);
  assert.equal(JSON.stringify(raw), before);
  for (const value of [undefined, null, false, "raw", {}, { findings: [null, {}] }, { findings: [finding("UNKNOWN", "Not checked", "No evidence", "unknown")] }]) assert.deepEqual(reportProsCons(value), { pros: [], cons: [] });
});

test("a malformed good hard-fail is still a concern and missing values are never zero", () => {
  const raw = { findings: [finding("CONFLICT", "Conflicting evidence", "Cannot establish safety", "good", true), finding("LP_LOCKED", "Liquidity lock reported", "The lowest reported pool lock is unknown.") ] };
  const result = reportProsCons(raw);
  assert.equal(result.cons[0].hardFail, true);
  assert.equal(result.pros[0].text, "Liquidity lock reported: The lowest reported pool lock is unknown.");
  assert.doesNotMatch(result.pros[0].text, /0%/);
});
