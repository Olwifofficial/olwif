import test from "node:test";
import assert from "node:assert/strict";
import { presentResearchReport } from "../lib/research/report-presentation.js";
import { reportTrafficLight } from "../lib/research/traffic-light.js";

const item = (code, title, detail, severity = "info", extra = {}) => ({
  code, title, detail, severity, category: "On-chain risk", hardFail: false, ...extra
});
const noWarnings = () => item("RUGCHECK_NO_LISTED_RISKS", "No RugCheck warnings returned", "This is a useful signal, not a guarantee that the creator or market is safe.", "good");
const rugged = () => item("RUGCHECK_RUGGED", "Token is marked rugged", "RugCheck's current report marks this mint as rugged.", "danger", { hardFail: true });
const reportWith = findings => ({
  version: 2, generatedAt: "2026-09-24T00:00:00.000Z", tier: "YELLOW", confidence: 65,
  riskScore: 12, hardFailCount: findings.filter(row => row.hardFail).length,
  identity: { name: "Example", symbol: "EX", creatorSource: "RugCheck creator field" },
  target: { address: "So11111111111111111111111111111111111111112", chain: "solana" },
  metrics: { holders: 7, holdersSource: "RugCheck report", insiderPercentage: 17.25 },
  momentum: { label: "Strong", score: 80 }, findings,
  sources: [{ name: "RugCheck", provider: "api.rugcheck.xyz", ok: true, url: "https://rugcheck.xyz/", message: "RugCheck snapshot available" }],
  research: {
    assessments: [{ name: "Integrity", status: "Partial checks passed", summary: "Only listed checks were performed." }],
    strengths: findings.filter(row => row.severity === "good").map(row => `${row.title}: ${row.detail}`),
    concerns: findings.filter(row => ["danger", "warn"].includes(row.severity)).map(row => `${row.title}: ${row.detail}`),
    unknowns: findings.filter(row => row.severity === "unknown").map(row => `${row.title}: ${row.detail}`),
    mainConcern: findings.find(row => ["danger", "warn"].includes(row.severity))?.detail || "Important due-diligence gaps remain.",
    links: [{ label: "RugCheck report", source: "RugCheck", url: "https://rugcheck.xyz/" }],
    market: { provider: "DEX Screener", windows: [{ volumeUsd: 123.45 }] }
  }
});
function freezeDeep(value) {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeDeep(child);
  }
  return value;
}

test("frozen raw input and every evidence/scoring field stay unchanged", () => {
  const raw = freezeDeep(reportWith([noWarnings(), rugged()]));
  const snapshot = JSON.stringify(raw);
  const shown = presentResearchReport(raw);
  assert.notEqual(shown, raw);
  assert.notEqual(shown.research, raw.research);
  assert.equal(JSON.stringify(raw), snapshot);
  for (const key of ["identity", "target", "metrics", "momentum", "sources"]) assert.equal(shown[key], raw[key]);
  for (const key of ["tier", "confidence", "riskScore", "hardFailCount", "generatedAt", "version"]) assert.equal(shown[key], raw[key]);
  for (const key of ["links", "market", "assessments"]) assert.equal(shown.research[key], raw.research[key]);
  shown.findings.forEach((finding, index) => {
    for (const key of ["severity", "code", "hardFail", "category"]) assert.equal(finding[key], raw.findings[index][key]);
  });
  assert.equal(raw.sources[0].name, "RugCheck");
  assert.equal(raw.findings[1].detail, "RugCheck's current report marks this mint as rugged.");
});

test("no listed warnings is clearly limited evidence, never a clean bill of health", () => {
  const shown = presentResearchReport(reportWith([noWarnings()]));
  assert.equal(shown.findings[0].title, "No warnings in the returned risk list");
  assert.match(shown.findings[0].detail, /only to the returned list/);
  assert.match(shown.findings[0].detail, /Other findings and gaps still apply; an empty list does not establish safety/);
  assert.doesNotMatch(shown.findings[0].detail, /RugCheck/);
  assert.match(shown.research.strengths[0], /^No warnings in the returned risk list:/);
  assert.equal(reportTrafficLight(shown).color, reportTrafficLight(reportWith([noWarnings()])).color);
});

test("rug-pull warning keeps critical severity and a red light but does not claim independent proof", () => {
  const raw = reportWith([rugged(), noWarnings()]);
  const shown = presentResearchReport(raw);
  assert.equal(shown.findings[0].title, "Rug-pull warning returned");
  assert.match(shown.findings[0].detail, /security check flags this mint/);
  assert.match(shown.findings[0].detail, /not been independently proven/);
  assert.equal(shown.findings[0].hardFail, true);
  assert.equal(shown.findings[0].severity, "danger");
  assert.equal(shown.findings[0].code, "RUGCHECK_RUGGED");
  assert.equal(reportTrafficLight(shown).color, "red");
  assert.equal(reportTrafficLight(raw).color, "red");
  assert.equal(shown.research.mainConcern, shown.findings[0].detail);
  assert.equal(shown.research.concerns[0], `${shown.findings[0].title}: ${shown.findings[0].detail}`);
  assert.equal(shown.findings[1].title, "No additional warnings in the risk list");
  assert.equal(shown.findings[1].severity, "good", "Legacy scoring data remains intact");
  assert.deepEqual(shown.research.strengths, [], "A contradictory empty risk list is not advertised as a strength");
  assert.equal(raw.research.strengths.length, 1, "Raw snapshot remains available in Sources & gaps");
});

test("possible insider flags retain numbers and uncertainty about ownership", () => {
  for (const count of ["4", "one or more"]) {
    const raw = reportWith([
      item("INSIDER_GRAPH", "Linked insider network detected", `RugCheck reported ${count} insider network(s).`, "danger"),
      item("INSIDER_SUPPLY_HIGH", "High insider concentration", "Approximately 17.25% is attributed to insiders.", "danger", { hardFail: true }),
      item("INSIDER_SUPPLY_ELEVATED", "Elevated insider concentration", "Approximately 7.50% is attributed to insiders.", "warn")
    ]);
    const shown = presentResearchReport(raw);
    assert.equal(shown.findings[0].title, "Possible linked insider network flagged");
    assert.ok(shown.findings[0].detail.startsWith(`The security check flags ${count} possible insider network(s).`));
    assert.match(shown.findings[0].detail, /not been independently verified/);
    assert.match(shown.findings[1].detail, /17\.25% to possible insiders/);
    assert.match(shown.findings[2].detail, /7\.50% to possible insiders/);
    assert.equal(shown.findings[1].hardFail, true);
  }
});

test("market, explorer, security and holder boilerplate becomes plain without dropping caveats or values", () => {
  const raw = reportWith([
    item("PAID_BOOSTS", "Paid visibility boost is active", "3 active boost(s) are reported by DEX Screener. Paid exposure is not proof of organic demand."),
    item("TOKEN_FOUND", "Exact token found on Blockscout", "Example (EX) resolves to the supplied contract.", "good"),
    item("SOL_TOP_HOLDER_MODERATE", "No exposed holder above 5%", "Largest non-market balance in the RugCheck snapshot: 3.25%.", "good"),
    item("GOPLUS_SOURCE_UNVERIFIED", "Security provider reports unverified source", "GoPlus marks the source as not open/verified. This app has not independently reviewed the bytecode or source.", "warn"),
    item("GOPLUS_SOURCE_REPORTED", "Security provider reports open source", "GoPlus reports source availability. Review the explorer source and administration; this is not an audit."),
    item("SELL_SIMULATION_UNAVAILABLE", "Independent sellability result unavailable", "GoPlus did not return coverage for this chain/address. A yellow result must not be treated as confirmed sellability.", "unknown"),
    item("HOLDERS_SECURITY_SNAPSHOT", "Holder snapshot from GoPlus", "These are the returned top balances, not a complete ownership or linked-wallet map. Pool and contract balances may be included."),
    item("RUGCHECK_RUGCHECK_SIGNAL", "RugCheck signal", "Risk signal returned by RugCheck.", "warn")
  ]);
  const shown = presentResearchReport(raw);
  assert.doesNotMatch(JSON.stringify(shown.findings), /RugCheck|DEX Screener|Blockscout|GoPlus/);
  assert.match(shown.findings[0].detail, /^3 active paid visibility boost/);
  assert.match(shown.findings[0].detail, /not proof of organic demand/);
  assert.equal(shown.findings[1].detail, raw.findings[1].detail);
  assert.match(shown.findings[2].detail, /3\.25%/);
  assert.match(shown.findings[2].title, /in the snapshot/);
  assert.match(shown.findings[3].detail, /not independently reviewed/);
  assert.match(shown.findings[4].detail, /not an audit/);
  assert.match(shown.findings[5].detail, /must not be treated as confirmed sellability/);
  assert.equal(shown.findings[6].detail, raw.findings[6].detail);
  assert.match(shown.findings[7].detail, /further details were not supplied/);
  assert.match(shown.research.unknowns[0], /^Independent sellability result unavailable: The security check/);
});

test("conflicting and partial evidence are not hidden or upgraded", () => {
  const conflicts = [
    item("HOLDER_COUNT_CONFLICT", "Holder totals conflict", "One source reports zero holders while another source or balance snapshot reports holders. The true total is not established; individual provider counts are shown with their provenance.", "unknown"),
    item("MARKET_SOURCE_DISAGREEMENT", "Market sources disagree", "The indexed token prices differ by about 18.1%. Different pools or indexing delays may explain this; check both charts.", "warn"),
    item("RUGCHECK_UNAVAILABLE", "Independent Solana risk report unavailable", "This source is not accepting public requests right now. Other available sources were checked.", "unknown")
  ];
  const raw = reportWith([noWarnings(), ...conflicts]);
  raw.sources.push({ name: "Solana mint", ok: false });
  raw.metrics.holders = null;
  raw.metrics.holderCountObservations = [{ count: 0, source: "RugCheck report" }, { count: 7, source: "GeckoTerminal metadata" }];
  const shown = presentResearchReport(raw);
  assert.deepEqual(shown.findings.slice(1), conflicts);
  assert.equal(shown.metrics.holders, null);
  assert.equal(shown.metrics.holderCountObservations, raw.metrics.holderCountObservations);
  assert.deepEqual(shown.research.unknowns, raw.research.unknowns);
  assert.equal(reportTrafficLight(shown).color, "amber");
});

test("project names, raw claims, links, external risk prose and unrelated cached concerns stay verbatim", () => {
  const raw = reportWith([
    item("TOKEN_FOUND", "Exact token found on Blockscout", "RugCheck DEX Screener (GoPlus) resolves to the supplied contract.", "good"),
    item("RUGCHECK_CUSTOM_RISK", "RugCheck token governance", "The project RugCheck claims it uses GoPlus; not independently verified.", "warn"),
    item("CUSTOM", "No RugCheck warnings returned", "A custom title is not generated boilerplate.")
  ]);
  raw.identity.name = "RugCheck";
  raw.identity.description = "RugCheck says it is safer than GoPlus and Blockscout.";
  raw.identity.websites = [{ url: "https://rugcheck.xyz/", label: "RugCheck", source: "GeckoTerminal metadata" }];
  raw.research.repositories = [{ name: "RugCheck/GoPlus", description: "DEX Screener data", source: "GitHub public API" }];
  raw.research.concerns.push("Reported repository RugCheck/GoPlus is archived. Verify whether development moved elsewhere.");
  raw.research.summary = "The project RugCheck claims to be safe.";
  const shown = presentResearchReport(raw);
  assert.deepEqual(shown.identity, raw.identity);
  assert.deepEqual(shown.research.repositories, raw.research.repositories);
  assert.deepEqual(shown.research.links, raw.research.links);
  assert.deepEqual(shown.findings.slice(1), raw.findings.slice(1));
  assert.equal(shown.findings[0].detail, raw.findings[0].detail);
  assert.equal(shown.research.concerns.at(-1), raw.research.concerns.at(-1));
  assert.equal(shown.research.summary, raw.research.summary);
});

test("cached duplicate narrative and branded boilerplate summaries update once, new wording is idempotent", () => {
  const raw = reportWith([rugged(), noWarnings()]);
  raw.summary = raw.findings[0].detail;
  raw.research.summary = `${raw.findings[1].title}: ${raw.findings[1].detail}`;
  const shown = presentResearchReport(raw);
  assert.equal(shown.summary, shown.findings[0].detail);
  assert.equal(shown.research.summary, `${shown.findings[1].title}: ${shown.findings[1].detail}`);
  assert.deepEqual(presentResearchReport(shown), shown);
});

test("missing optional report fields are not invented and unknown formats are preserved", () => {
  for (const input of [null, undefined, false, "raw"]) assert.equal(presentResearchReport(input), input);
  assert.deepEqual(presentResearchReport({}), {});
  assert.deepEqual(presentResearchReport({ findings: [null], research: { summary: null } }), { findings: [null], research: { summary: null } });
  const custom = reportWith([item("RUGCHECK_NO_LISTED_RISKS", "A customised title", "Extra contradictory evidence requires review.", "warn")]);
  assert.deepEqual(presentResearchReport(custom).findings, custom.findings);
});
