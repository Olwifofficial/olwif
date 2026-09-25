import test from "node:test";
import assert from "node:assert/strict";
import { classifyFindings, compareReports, isProtocolHolder, parseTarget, scanTarget } from "../lib/research/analyzer.js";

test("parses an exact EVM Pump.fun address and ignores clip query data", () => {
  const parsed = parseTarget("https://pump.fun/coin/0xB8Cf4ad387cfd607C66a207CFFFC46498aACd9d6?clip=123");
  assert.equal(parsed.address, "0xB8Cf4ad387cfd607C66a207CFFFC46498aACd9d6");
  assert.equal(parsed.chain, "auto");
  assert.match(parsed.platform, /^pump.fun/);
});

test("parses an exact Solana Pump.fun mint", () => {
  const parsed = parseTarget("https://pump.fun/coin/2fWzx35rQMAATQGhJzVTvzeXHcenCQLqCog9Jkg5pump");
  assert.equal(parsed.address, "2fWzx35rQMAATQGhJzVTvzeXHcenCQLqCog9Jkg5pump");
  assert.equal(parsed.chain, "solana");
});

test("rejects text that contains no exact contract", () => {
  assert.equal(parseTarget("this is only a coin name"), null);
});

test("recognizes protocol and burn holder labels", () => {
  assert.equal(isProtocolHolder({ address: { hash: "0x1111111111111111111111111111111111111111", name: "PonsV2LaunchLocker" } }), true);
  assert.equal(isProtocolHolder({ address: { hash: "0x000000000000000000000000000000000000dEaD" } }), true);
  assert.equal(isProtocolHolder({ address: { hash: "0x2222222222222222222222222222222222222222" } }), false);
});

test("a hard failure always produces REJECT", () => {
  const result = classifyFindings([
    { severity: "good", hardFail: false },
    { severity: "danger", hardFail: true }
  ], 100);
  assert.equal(result.tier, "REJECT");
  assert.equal(result.hardFailCount, 1);
});

test("watch comparison reports worsening risk and liquidity", () => {
  const alerts = compareReports(
    { tier: "YELLOW", riskScore: 12, metrics: { liquidityUsd: 10000, topHolderPct: 3 }, findings: [] },
    { tier: "RED", riskScore: 70, metrics: { liquidityUsd: 5000, topHolderPct: 6 }, findings: [{ code: "HONEYPOT", title: "Honeypot", hardFail: true }] }
  );
  assert.equal(alerts.length, 5);
});

const MINT = "2fWzx35rQMAATQGhJzVTvzeXHcenCQLqCog9Jkg5pump";
const OTHER = "2FWzx35rQMAATQGhJzVTvzeXHcenCQLqCog9Jkg5pump";
const PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const mintInfo = () => ({ supply: "10000000", decimals: 6, mintAuthority: null, freezeAuthority: null });
const account = () => ({ owner: PROGRAM, data: { parsed: { type: "mint", info: mintInfo() } } });
const rug = () => ({ mint: MINT, token: mintInfo(), tokenMeta: { name: "Exact fixture", symbol: "EXACT" }, risks: [], totalHolders: null, score: null });
const pair = () => ({
  chainId: "solana", pairAddress: "pool", dexId: "fixture", baseToken: { address: MINT, name: "Exact fixture", symbol: "EXACT" },
  quoteToken: { address: OTHER }, priceUsd: "0.002", marketCap: 2000, liquidity: { usd: null },
  volume: { h1: 500 }, txns: { h1: { buys: 20, sells: 10 } }, priceChange: { h1: 10 }
});
const ok = (data) => ({ ok: true, json: async () => data });
function fixtureFetch({ rugData = rug(), pairs = [pair()], rpcData, deniedHost, calls = [] } = {}) {
  return async (url, init = {}) => {
    calls.push(url);
    if (url.includes("api.rugcheck.xyz")) return ok(rugData);
    if (url.includes("api.dexscreener.com")) return ok({ pairs });
    if (deniedHost && url.includes(deniedHost)) return { ok: false, status: 403 };
    const { method } = JSON.parse(init.body);
    const result = rpcData ? rpcData(method) : method === "getAccountInfo"
      ? { value: account() } : { value: [{ address: MINT, amount: "100000" }] };
    return ok({ jsonrpc: "2.0", id: 1, result });
  };
}

test("manual Solana report recovers from an access-denied configured source", async () => {
  const report = await scanTarget(MINT, {
    solanaRpcUrl: "https://api.mainnet-beta.solana.com/", fetchImpl: fixtureFetch({ deniedHost: "api.mainnet-beta.solana.com" })
  });
  for (const name of ["Solana mint", "Solana holders"]) {
    const source = report.sources.find((item) => item.name === name);
    assert.equal(source.ok, true);
    assert.equal(source.provider, "solana-rpc.publicnode.com");
    assert.equal(source.attempts.length, 2);
    assert.match(source.message, /fallback/);
    assert.ok(Date.parse(source.checkedAt));
  }
  assert.doesNotMatch(JSON.stringify(report), /403|Forbidden/);
  assert.equal(report.identity.address, MINT);
  assert.equal(report.metrics.rawLargestAccountPct, 1);
});

test("only a matching case-sensitive Solana BASE token and chain supplies market data", async () => {
  for (const mismatched of [
    { ...pair(), baseToken: { address: OTHER }, quoteToken: { address: MINT } },
    { ...pair(), chainId: "ethereum" },
    { ...pair(), baseToken: { address: MINT.toLowerCase() } }
  ]) {
    const report = await scanTarget(MINT, { fetchImpl: fixtureFetch({ pairs: [mismatched] }) });
    assert.equal(report.sources.find((source) => source.name === "DEX market").ok, false);
    assert.equal(report.metrics.priceUsd, undefined);
    assert.equal(report.momentum.score, null);
  }
});

test("RugCheck wrong-mint, missing-mint and empty risk responses are not coverage", async () => {
  for (const rugData of [{ ...rug(), mint: OTHER }, { risks: [] }, {}, { mint: MINT, risks: [] }]) {
    const report = await scanTarget(MINT, { fetchImpl: fixtureFetch({ rugData, pairs: [] }) });
    assert.equal(report.sources.find((source) => source.name === "RugCheck").ok, false);
    assert.equal(report.identity.name, null);
    assert.equal(report.findings.some((item) => item.code === "RUGCHECK_NO_LISTED_RISKS"), false);
  }
});

test("empty successful responses retain unknowns, not safety or source coverage", async () => {
  const report = await scanTarget(MINT, { fetchImpl: fixtureFetch({ rugData: {}, pairs: [], rpcData: () => ({ value: null }) }) });
  assert.equal(report.sources.every((source) => !source.ok), true);
  assert.equal(report.tier, "UNKNOWN");
  assert.equal(report.findings.some((item) => item.severity === "good"), false);
  assert.equal(report.metrics.holders, undefined);
  assert.equal(report.momentum.score, null);
});

test("a rug warning is never accompanied by an empty-list positive finding", async () => {
  const report = await scanTarget(MINT, { fetchImpl: fixtureFetch({ rugData: { ...rug(), rugged: true } }) });
  assert.equal(report.findings.some(item => item.code === "RUGCHECK_RUGGED" && item.hardFail), true);
  assert.equal(report.findings.some(item => item.code === "RUGCHECK_NO_LISTED_RISKS"), false);
  assert.equal(report.tier, "REJECT");
});

test("holder RPC failure can use a labelled lower-confidence RugCheck snapshot", async () => {
  const meta = rug();
  meta.topHolders = [{ owner: MINT, address: OTHER, pct: 2, amount: 200000 }];
  const report = await scanTarget(MINT, { fetchImpl: fixtureFetch({ rugData: meta, rpcData: (method) => ({ value: method === "getAccountInfo" ? account() : [] }) }) });
  const source = report.sources.find((item) => item.name === "Solana holders");
  assert.equal(source.ok, true);
  assert.equal(source.snapshot, true);
  assert.equal(source.provider, "api.rugcheck.xyz");
  assert.match(source.message, /snapshot/);
  assert.match(source.message, /age is not supplied/);
  assert.equal(source.attempts.length, 3);
  assert.equal(report.metrics.topHolderPct, 2);
  assert.equal(report.metrics.rawLargestAccountPct, undefined);
  const live = await scanTarget(MINT, { fetchImpl: fixtureFetch({ rugData: meta }) });
  assert.ok(report.confidence < live.confidence);
});

test("null numeric values and missing momentum inputs stay unknown", async () => {
  const report = await scanTarget(MINT, { fetchImpl: fixtureFetch({ pairs: [{ ...pair(), priceUsd: null, marketCap: 2000, txns: {}, priceChange: {} }] }) });
  assert.equal(report.metrics.priceUsd, null);
  assert.equal(report.metrics.liquidityUsd, null);
  assert.equal(report.metrics.holders, null);
  assert.equal(report.metrics.rugCheckScore, null);
  assert.equal(report.metrics.rugged, null);
  assert.equal(report.momentum.score, null);
  assert.equal(report.findings.some((item) => item.code === "LIQUIDITY_CRITICAL"), false);
});

test("missing authority fields are not reported revoked and non-mint accounts do not pass", async () => {
  const incomplete = account();
  delete incomplete.data.parsed.info.mintAuthority;
  delete incomplete.data.parsed.info.freezeAuthority;
  let report = await scanTarget(MINT, { fetchImpl: fixtureFetch({ rpcData: (method) => method === "getAccountInfo" ? { value: incomplete } : { value: [] } }) });
  assert.equal(report.findings.some((item) => item.code === "MINT_AUTHORITY_REVOKED"), false);
  assert.equal(report.findings.some((item) => item.code === "MINT_AUTHORITY_UNKNOWN"), true);
  const wrong = account();
  wrong.data.parsed.type = "account";
  report = await scanTarget(MINT, { fetchImpl: fixtureFetch({ rpcData: () => ({ value: wrong }) }) });
  assert.equal(report.sources.find((source) => source.name === "Solana mint").ok, false);
});

test("project links merge validated metadata sources, reject unsafe URLs and label provenance", async () => {
  const dex = pair();
  dex.info = {
    websites: [{ label: "Project", url: "https://project.example/" }, { url: "javascript:alert(1)" }, { url: "data:text/html,bad" }, { url: "https://user:pass@fake.example/" }],
    socials: [{ type: "twitter", url: "https://x.com/example" }, { url: "file:///wallet" }]
  };
  const meta = rug();
  meta.fileMeta = { website: "https://project.example/", extensions: { telegram: "https://t.me/example" } };
  const report = await scanTarget(MINT, { fetchImpl: fixtureFetch({ pairs: [dex], rugData: meta }) });
  assert.equal(report.identity.websites.length, 1);
  assert.equal(report.identity.socials.length, 2);
  for (const link of [...report.identity.websites, ...report.identity.socials]) {
    assert.match(link.url, /^https:\/\//);
    assert.ok(link.source);
    assert.equal(link.verified, false);
  }
  assert.equal(report.identity.socials.find((link) => link.type === "telegram").source, "RugCheck metadata");
});
