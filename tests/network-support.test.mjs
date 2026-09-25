import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { parseTarget, scanTarget } from "../lib/research/analyzer.js";
import { RESEARCH_CHAINS } from "../lib/research/research-report.js";

function moduleUrl(path, replacements = {}) {
  let source = readFileSync(new URL(path, import.meta.url), "utf8");
  for (const [before, after] of Object.entries(replacements)) source = source.replace(before, after);
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  return "data:text/javascript;base64," + Buffer.from(outputText).toString("base64");
}

const securityUrl = moduleUrl("../lib/security.ts");
const { NETWORKS, providerForHost } = await import(securityUrl);
const { sourceFetch } = await import(moduleUrl("../lib/source-fetch.ts", {
  '"./security"': JSON.stringify(securityUrl),
}));
const settings = { enabled: true, notice: "", disabledSources: [] };
const ADDRESS = "0x1da81Ca017949efbe07972776580D04592Ba9b63";
const OTHER = "0x2222222222222222222222222222222222222222";
const PUMP_LINK = `https://pump.fun/coin/${ADDRESS}`;
const EXPLORER = "https://robinhoodchain.blockscout.com";
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json" },
});
const pair = (chain = "robinhood", address = ADDRESS) => ({
  chainId: chain, pairAddress: OTHER, dexId: "fixture",
  url: `https://dexscreener.com/${chain}/${OTHER}`,
  baseToken: { address, name: "Fixture token", symbol: "FIX" },
  quoteToken: { address: OTHER }, priceUsd: "0.25",
  liquidity: { usd: 12000 }, volume: { h24: 500 },
});

// All data is synthetic. The actual sourceFetch security boundary runs against
// this in-memory upstream; these tests never make a real provider request.
function fixture({ searchPairs = [pair()], marketPairs = [pair()], tokenAddress = ADDRESS, explorerStatus = 200 } = {}) {
  const calls = [];
  const upstream = async (raw, init) => {
    const url = new URL(raw);
    calls.push({ url, init });
    if (url.hostname === "api.dexscreener.com" && url.pathname === "/latest/dex/search") {
      return json({ pairs: searchPairs });
    }
    if (url.hostname === "api.dexscreener.com" && url.pathname === `/tokens/v1/robinhood/${ADDRESS}`) {
      return json(marketPairs);
    }
    if (url.hostname === "robinhoodchain.blockscout.com") {
      if (explorerStatus !== 200) return json({}, explorerStatus);
      if (url.pathname === `/api/v2/tokens/${ADDRESS}`) {
        return json({ address_hash: tokenAddress, name: "Fixture token", symbol: "FIX", total_supply: "1000000", decimals: "6", holders_count: 12 });
      }
      if (url.pathname === `/api/v2/tokens/${ADDRESS}/holders`) {
        return json({ items: [{ address: { hash: OTHER, is_contract: false }, value: "1000" }] });
      }
      if (url.pathname === `/api/v2/smart-contracts/${ADDRESS}`) return json({ is_verified: true });
      if (url.pathname === `/api/v2/addresses/${ADDRESS}`) return json({ hash: tokenAddress });
    }
    return json({}, 404);
  };
  return { calls, fetchImpl: sourceFetch(settings, "", upstream) };
}

test("public network choices cover exactly the analyzer's configured chains", () => {
  assert.deepEqual(NETWORKS.filter((network) => network !== "auto").sort(), Object.keys(RESEARCH_CHAINS).sort());
  assert.equal(NETWORKS.includes("robinhood"), true);
  assert.equal(RESEARCH_CHAINS.robinhood.id, "4663");
});

test("the reported Pump.fun link preserves its exact EVM address and requires network detection", () => {
  for (const input of [PUMP_LINK, `${PUMP_LINK}?clip=fixture`]) {
    const parsed = parseTarget(input);
    assert.equal(parsed.address, ADDRESS);
    assert.equal(parsed.chain, "auto");
    assert.match(parsed.platform, /pump\.fun.*origin unverified/);
  }
});

test("a unique exact Robinhood match completes through the real provider allowlist", async () => {
  const { calls, fetchImpl } = fixture();
  const report = await scanTarget(PUMP_LINK, { chain: "auto", fetchImpl });
  assert.equal(report.target.address, ADDRESS);
  assert.equal(report.target.chain, "robinhood");
  assert.equal(NETWORKS.includes(report.target.chain), true);
  assert.equal(report.identity.chain, "Robinhood Chain");
  assert.equal(report.identity.name, "Fixture token");
  assert.equal(report.metrics.holders, 12);
  for (const name of ["Blockscout token", "Blockscout holders", "Verified contract", "Contract address", "DEX market"]) {
    assert.equal(report.sources.find((source) => source.name === name)?.ok, true, name);
  }
  assert.ok(report.research.links.some((link) => link.url === `${EXPLORER}/token/${ADDRESS}`));
  assert.ok(calls.some(({ url }) => url.href === `${EXPLORER}/api/v2/tokens/${ADDRESS}`));
  assert.ok(calls.some(({ url }) => url.pathname === "/api/v1/token_security/4663" && url.searchParams.get("contract_addresses") === ADDRESS.toLowerCase()));
  assert.equal(calls.filter(({ url }) => url.pathname === "/latest/dex/search").length, 1);
  assert.equal(calls[0].url.searchParams.get("q"), ADDRESS);
  assert.equal(calls.some(({ url }) => /\/networks\/(?:null|undefined)\//.test(url.pathname)), false);
  assert.ok(calls.some(({ url }) => url.hostname === "api.geckoterminal.com" && url.pathname.startsWith("/api/v2/networks/robinhood/")));
  for (const name of ["GeckoTerminal market", "GeckoTerminal metadata"]) {
    assert.equal(report.sources.find((source) => source.name === name)?.ok, false, name);
  }
  for (const { init } of calls) {
    assert.equal(init.redirect, "manual");
    assert.equal(init.credentials, "omit");
    assert.equal(init.headers.get("Authorization"), null);
  }
});

test("a denied Robinhood explorer retains exact DEX evidence without claiming on-chain verification", async () => {
  const { calls, fetchImpl } = fixture({ explorerStatus: 403 });
  const report = await scanTarget(PUMP_LINK, { chain: "auto", fetchImpl });
  assert.equal(report.target.chain, "robinhood");
  assert.equal(NETWORKS.includes(report.target.chain), true);
  assert.equal(report.sources.find((source) => source.name === "DEX market")?.ok, true);
  assert.equal(report.sources.find((source) => source.name === "Blockscout token")?.ok, false);
  assert.equal(report.sources.find((source) => source.name === "Verified contract")?.ok, false);
  assert.equal(report.findings.some((finding) => ["TOKEN_FOUND", "SOURCE_VERIFIED"].includes(finding.code)), false);
  assert.equal(report.research.assessments.find((assessment) => assessment.name === "Identity")?.status, "Exact address indexed");
  assert.equal(report.metrics.priceUsd, 0.25);
  assert.equal(report.identity.name, "Fixture token");
  assert.ok(calls.some(({ url }) => url.hostname === "robinhoodchain.blockscout.com"));
});

test("auto detection rejects ambiguous, unknown-chain and wrong-address results before token requests", async () => {
  const cases = [
    [],
    [pair("robinhood"), pair("base")],
    [pair("unsupported-chain")],
    [{ ...pair("robinhood", OTHER), quoteToken: { address: ADDRESS } }],
  ];
  for (const searchPairs of cases) {
    const { calls, fetchImpl } = fixture({ searchPairs });
    await assert.rejects(scanTarget(PUMP_LINK, { fetchImpl }), /one unambiguous supported network/);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url.pathname, "/latest/dex/search");
  }
});

test("Robinhood explorer responses for a different token cannot establish token identity", async () => {
  const { fetchImpl } = fixture({ tokenAddress: OTHER, marketPairs: [pair("robinhood", OTHER)] });
  const report = await scanTarget(ADDRESS, { chain: "robinhood", fetchImpl });
  assert.equal(report.sources.find((source) => source.name === "Blockscout token")?.ok, false);
  assert.equal(report.sources.find((source) => source.name === "Contract address")?.ok, false);
  assert.equal(report.sources.find((source) => source.name === "DEX market")?.ok, false);
  assert.equal(report.findings.some((finding) => finding.code === "TOKEN_FOUND"), false);
  assert.equal(report.identity.name, null);
  assert.equal(report.metrics.holders, undefined);
});

test("every configured Blockscout explorer passes the exact host allowlist", async () => {
  const calls = [];
  const fetchImpl = sourceFetch(settings, "", async (url) => { calls.push(url); return json({}); });
  for (const [chain, config] of Object.entries(RESEARCH_CHAINS)) {
    if (!config.blockscout) continue;
    assert.equal(providerForHost(new URL(config.blockscout).hostname), "blockscout", chain);
    await fetchImpl(`${config.blockscout}/api/v2/tokens/${ADDRESS}`);
  }
  assert.equal(calls.length, Object.values(RESEARCH_CHAINS).filter((config) => config.blockscout).length);
  assert.ok(calls.includes(`${EXPLORER}/api/v2/tokens/${ADDRESS}`));
});

test("Robinhood source support still rejects spoofed hosts and respects disabled Blockscout", async () => {
  let requests = 0;
  const upstream = async () => { requests++; return json({}); };
  const fetchImpl = sourceFetch(settings, "", upstream);
  for (const url of [
    `https://robinhoodchain.blockscout.com.evil.example/api/v2/tokens/${ADDRESS}`,
    `https://evil.robinhoodchain.blockscout.com/api/v2/tokens/${ADDRESS}`,
    `https://user:pass@robinhoodchain.blockscout.com/api/v2/tokens/${ADDRESS}`,
    `http://robinhoodchain.blockscout.com/api/v2/tokens/${ADDRESS}`,
    `https://robinhoodchain.blockscout.com:8443/api/v2/tokens/${ADDRESS}`,
  ]) {
    await assert.rejects(fetchImpl(url), /Unapproved data source/);
  }
  const disabled = sourceFetch({ ...settings, disabledSources: ["blockscout"] }, "", upstream);
  await assert.rejects(disabled(`${EXPLORER}/api/v2/tokens/${ADDRESS}`), /paused by the site owner/);
  assert.equal(requests, 0);
});
