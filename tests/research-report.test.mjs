import test from "node:test";
import assert from "node:assert/strict";
import { parseTarget, scanTarget } from "../lib/research/analyzer.js";
import { chainFromUrl, explorerLink, RESEARCH_CHAINS } from "../lib/research/research-report.js";

const ADDRESS = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
const MINT = "So11111111111111111111111111111111111111112";
const PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const ok = (data) => ({ ok: true, json: async () => data });
const absent = () => ({ ok: false, status: 404 });
const mintInfo = { supply: "1000000000", decimals: 9, mintAuthority: null, freezeAuthority: null };
const pair = (chain = "base", address = ADDRESS) => ({ chainId: chain, pairAddress: OTHER, dexId: "fixture", url: `https://dexscreener.com/${chain}/${OTHER}`, baseToken: { address, name: "Token", symbol: "TKN" }, priceUsd: "1", marketCap: null, fdv: 1000, liquidity: { usd: 10000 }, volume: { m5: 50, h1: 1000, h6: 2000, h24: 10000 }, txns: { m5: { buys: 2, sells: 1 }, h1: { buys: 40, sells: 30 } }, priceChange: { m5: 1, h1: 2 } });
const geckoPool = (network = "base", address = ADDRESS) => ({ data: [{ id: `${network}_${OTHER}`, type: "pool", attributes: { address: OTHER, base_token_price_usd: "1.05", reserve_in_usd: "12000", market_cap_usd: null, fdv_usd: "1000", volume_usd: { h1: "1100" }, transactions: { h1: { buys: 42, sells: 28 } }, price_change_percentage: { h1: "2" } }, relationships: { base_token: { data: { id: `${network}_${address}` } }, quote_token: { data: { id: `${network}_${OTHER}` } } } }], included: [{ id: `${network}_${address}`, attributes: { address, name: "Token", symbol: "TKN" } }] });
const metadata = (network = "base", address = ADDRESS) => ({ data: { id: `${network}_${address}`, attributes: { address, websites: ["https://token.example/"], twitter_handle: "example", telegram_handle: "example", description: "A project claim" } } });

function fetchFixture({ pairs = [pair()], gecko = geckoPool(), meta = metadata(), goplus, contract, token, addressInfo, holders, creatorHistory, rug, repository, calls = [] } = {}) {
  return async (url, init = {}) => {
    calls.push({ url, init });
    if (url.includes("api.dexscreener.com")) return ok(url.includes("/search?") ? { pairs } : pairs);
    if (url.includes("api.geckoterminal.com")) return ok(url.includes("/info") ? meta : gecko);
    if (url.includes("api.gopluslabs.io")) return goplus ? ok(goplus) : absent();
    if (url.includes("api.github.com")) return repository ? ok(repository) : absent();
    if (url.includes("/transactions?")) return creatorHistory ? ok(creatorHistory) : absent();
    if (url.includes("/smart-contracts/")) return contract ? ok(contract) : absent();
    if (url.includes("/holders")) return holders ? ok(holders) : absent();
    if (url.includes(".blockscout.com/api/v2/tokens")) return token ? ok(token) : absent();
    if (url.includes(".blockscout.com/api/v2/addresses")) return addressInfo ? ok(addressInfo) : absent();
    if (url.includes("api.rugcheck.xyz")) return rug ? ok(rug) : absent();
    if (init.method === "POST") {
      const { method } = JSON.parse(init.body);
      return ok({ jsonrpc: "2.0", id: 1, result: method === "getAccountInfo" ? { value: { owner: PROGRAM, data: { parsed: { type: "mint", info: mintInfo } } } } : { value: [{ address: MINT, amount: "1000000" }] } });
    }
    return absent();
  };
}

test("strict parsing never infers an EVM chain from the address or a spoofed hostname", () => {
  assert.equal(parseTarget(ADDRESS).chain, "auto");
  assert.equal(parseTarget(`https://pump.fun/coin/${ADDRESS}`).chain, "auto");
  for (const [chain, config] of Object.entries(RESEARCH_CHAINS)) {
    const address = chain === "solana" ? MINT : ADDRESS;
    assert.equal(parseTarget(`${config.explorer}/token/${address}`).chain, chain);
  }
  assert.equal(chainFromUrl(`https://etherscan.io.evil.example/token/${ADDRESS}`), null);
  assert.equal(parseTarget(`${ADDRESS}abc`), null);
  assert.equal(parseTarget(`https://dexscreener.com/base/${ADDRESS}`), null);
  assert.equal(parseTarget(`https://site.example/?token=${ADDRESS}`), null);
  assert.equal(parseTarget(`javascript:alert('${ADDRESS}')`), null);
  assert.equal(parseTarget(`https://user:pass@etherscan.io/token/${ADDRESS}`), null);
  assert.equal(explorerLink("base", "javascript:bad"), null);
  assert.equal(parseTarget(`https://pump.fun.evil.example/coin/${MINT}`).platform, "Direct address");
  assert.equal(parseTarget(`https://site.example/coin/${MINT}?source=pump.fun`).platform, "Direct address");
  assert.match(parseTarget(`https://pump.fun/coin/${MINT}`).platform, /origin unverified/);
});

test("conflicting zero holder counts become unknown with both source observations retained", async () => {
  const rug = { mint: MINT, token: mintInfo, risks: [], totalHolders: 0 };
  const meta = metadata("solana", MINT);
  meta.data.attributes.holders = { count: 12345, last_updated: "2026-09-23T12:00:00Z" };
  const report = await scanTarget(MINT, { fetchImpl: fetchFixture({ pairs: [], gecko: {}, meta, rug }) });
  assert.equal(report.metrics.holders, null);
  assert.equal(report.metrics.holdersSource, "Conflicting source snapshots");
  assert.equal(report.findings.some((item) => item.code === "HOLDER_COUNT_CONFLICT"), true);
  assert.deepEqual(report.metrics.holderCountObservations.map(({ count, source, upstreamUpdatedAt }) => ({ count, source, upstreamUpdatedAt })), [
    { count: 0, source: "RugCheck report", upstreamUpdatedAt: null },
    { count: 12345, source: "GeckoTerminal metadata", upstreamUpdatedAt: "2026-09-23T12:00:00Z" }
  ]);
});

test("valid holder totals expose provenance and invalid/negative totals do not become facts", async () => {
  const report = await scanTarget(ADDRESS, { chain: "base", fetchImpl: fetchFixture({ token: { address_hash: ADDRESS, symbol: "TKN", holders_count: 123, total_supply: "1000" } }) });
  assert.equal(report.metrics.holders, 123);
  assert.equal(report.metrics.holdersSource, "Blockscout token");
  assert.equal(report.metrics.holdersUpdatedAt, null);
  for (const holders_count of [-1, 1.5, "", null]) {
    const unknown = await scanTarget(ADDRESS, { chain: "base", fetchImpl: fetchFixture({ token: { address_hash: ADDRESS, symbol: "TKN", holders_count, total_supply: "1000" } }) });
    assert.equal(unknown.metrics.holders, null);
    assert.equal(unknown.metrics.holderCountObservations, undefined);
  }
});

test("explicit network conflicts fail before any request", async () => {
  let calls = 0;
  const options = { chain: "base", fetchImpl: async () => { calls++; return absent(); } };
  await assert.rejects(scanTarget(`https://etherscan.io/token/${ADDRESS}`, options), /conflicts/);
  await assert.rejects(scanTarget(MINT, options), /conflicts/);
  await assert.rejects(scanTarget(ADDRESS, { ...options, chain: "solana" }), /not a Solana/);
  await assert.rejects(scanTarget({ address: OTHER, input: ADDRESS, chain: "base" }, options), /exact token/);
  assert.equal(calls, 0);
});

test("auto detection only accepts one exact BASE-address chain and uses that network endpoints", async () => {
  const calls = [];
  const report = await scanTarget(ADDRESS, { fetchImpl: fetchFixture({ calls }) });
  assert.equal(report.target.chain, "base");
  assert.equal(report.identity.chain, "Base");
  assert.ok(calls.some(({ url }) => url.includes("/token_security/8453?")));
  assert.ok(calls.some(({ url }) => url.includes("base.blockscout.com/api/v2/tokens/")));
  assert.equal(calls.some(({ url }) => url.includes("robinhoodchain")), false);
  for (const pairs of [[], [pair("base"), pair("ethereum")], [{ ...pair(), baseToken: { address: OTHER }, quoteToken: { address: ADDRESS } }]]) {
    await assert.rejects(scanTarget(ADDRESS, { fetchImpl: fetchFixture({ pairs }) }), /Select the project's network/);
  }
});

test("fresh requests use no browser cache or cookies and preserve upstream age uncertainty", async () => {
  const calls = [];
  const report = await scanTarget(ADDRESS, { chain: "base", fetchImpl: fetchFixture({ calls }) });
  assert.ok(calls.length > 4);
  assert.equal(calls.every(({ init }) => init.cache === "no-store" && init.credentials === "omit"), true);
  assert.ok(report.sources.every((source) => Number.isFinite(Date.parse(source.checkedAt))));
  assert.equal(report.research.freshness.upstreamUpdatedAt, null);
  assert.match(report.research.freshness.description, /indexing\/caching delay is unknown/);
  assert.equal(report.research.assessments.length, 5);
  assert.equal(report.research.assessments.find((item) => item.name === "Flow quality").status, "Not established");
});

test("GeckoTerminal corroboration validates chain, BASE token and supplies fallback not mixed data", async () => {
  const report = await scanTarget(ADDRESS, { chain: "base", fetchImpl: fetchFixture({ pairs: [] }) });
  assert.equal(report.metrics.priceUsd, 1.05);
  assert.equal(report.research.market.provider, "GeckoTerminal");
  assert.equal(report.metrics.marketCap, null);
  for (const gecko of [geckoPool("eth"), geckoPool("base", OTHER), { data: [] }]) {
    const wrong = await scanTarget(ADDRESS, { chain: "base", fetchImpl: fetchFixture({ pairs: [], gecko }) });
    assert.equal(wrong.metrics.priceUsd, undefined);
    assert.equal(wrong.sources.find((source) => source.name === "GeckoTerminal market").ok, false);
  }
});

test("market source disagreements are called out and zero/unknown windows are distinct", async () => {
  const gecko = geckoPool(); gecko.data[0].attributes.base_token_price_usd = "2";
  const report = await scanTarget(ADDRESS, { chain: "base", fetchImpl: fetchFixture({ gecko }) });
  assert.equal(report.findings.some((item) => item.code === "MARKET_SOURCE_DISAGREEMENT"), true);
  assert.equal(report.metrics.priceUsd, 1);
  assert.deepEqual(report.research.market.windows[0], { window: "5m", volumeUsd: 50, buys: 2, sells: 1, transactions: 3, priceChangePct: 1 });
  assert.equal(report.research.market.windows[2].transactions, null);
});

test("metadata links are safe, source-reported and exact-address matched", async () => {
  const meta = metadata();
  meta.data.attributes.websites = ["https://token.example/docs", "javascript:alert(1)", "https://user:secret@evil.example/"];
  meta.data.attributes.twitter_handle = "bad/../../path";
  const report = await scanTarget(ADDRESS, { chain: "base", fetchImpl: fetchFixture({ meta }) });
  assert.equal(report.identity.websites.length, 1);
  assert.equal(report.identity.socials.some((link) => link.type === "twitter"), false);
  assert.ok(report.research.links.some((link) => link.kind === "docs"));
  assert.equal(report.research.links.every((link) => link.verified === false), true);
  const wrong = await scanTarget(ADDRESS, { chain: "base", fetchImpl: fetchFixture({ meta: metadata("eth") }) });
  assert.equal(wrong.identity.websites.length, 0);
});

test("GoPlus null tax is unknown, wrong-address/security-empty payload does not pass", async () => {
  const security = { code: 1, result: { [ADDRESS]: { token_name: "Token", is_open_source: "1", buy_tax: "0", sell_tax: "", holder_count: "20" } } };
  const report = await scanTarget(ADDRESS, { chain: "base", fetchImpl: fetchFixture({ goplus: security }) });
  assert.equal(report.metrics.sellTax, null);
  assert.match(report.findings.find((item) => item.code === "TAX_CHECKED").detail, /sell tax: unknown/);
  assert.equal(report.findings.some((item) => item.code === "SELLABILITY_PARTIAL"), true);
  for (const goplus of [{ code: 1, result: { [OTHER]: security.result[ADDRESS] } }, { code: 1, result: { [ADDRESS]: { token_name: "Only a name" } } }, { code: 2, result: security.result }]) {
    const wrong = await scanTarget(ADDRESS, { chain: "base", fetchImpl: fetchFixture({ goplus }) });
    assert.equal(wrong.sources.find((source) => source.name === "GoPlus security").ok, false);
  }
});

test("creator is not inferred from metadata authority and holder balances retain source links", async () => {
  const rug = { mint: MINT, token: mintInfo, risks: [], tokenMeta: { updateAuthority: MINT }, topHolders: [{ owner: MINT, pct: 2, address: MINT }] };
  const report = await scanTarget(MINT, { fetchImpl: fetchFixture({ pairs: [pair("solana", MINT)], gecko: {}, meta: {}, rug }) });
  assert.equal(report.identity.creator, null);
  assert.equal(report.identity.updateAuthority, MINT);
  assert.equal(report.metrics.topHolders[0].url, `https://solscan.io/address/${MINT}`);
  assert.match(report.research.creator.historyCoverage, /Unknown/);
});

test("untrusted pool/vault labels do not hide an EVM holder and creation history is explicitly bounded", async () => {
  const report = await scanTarget(ADDRESS, { chain: "base", fetchImpl: fetchFixture({
    token: { address_hash: ADDRESS, name: "Token", total_supply: "1000" }, contract: { is_verified: true, abi: [] },
    addressInfo: { hash: ADDRESS, creator_address_hash: OTHER },
    holders: { items: [{ address: { hash: OTHER, name: "Friendly vault pool" }, value: "300" }] },
    creatorHistory: { items: [{ status: "ok", created_contract: { hash: ADDRESS }, timestamp: "2026-09-01T00:00:00Z" }, { status: "ok", to: null }] }
  }) });
  assert.equal(report.metrics.topHolderPct, 30);
  assert.equal(report.research.creator.recentContractCreations, 1);
  assert.match(report.research.creator.historyCoverage, /not necessarily token launches/);
  assert.equal(report.research.creator.previousContracts[0].url, `https://basescan.org/address/${ADDRESS}`);
});

test("GitHub only checks direct provider-reported repositories and does not claim authenticity", async () => {
  const meta = metadata();
  meta.data.attributes.websites = ["https://github.com/example/project", "https://github.com/just-an-owner", "https://github.com.evil.example/owner/repo"];
  const calls = [];
  const report = await scanTarget(ADDRESS, { chain: "base", fetchImpl: fetchFixture({ calls, meta, repository: { private: false, full_name: "example/project", archived: true, fork: true, created_at: "2020-01-01T00:00:00Z", pushed_at: "2021-01-01T00:00:00Z", license: { spdx_id: "MIT" } } }) });
  assert.equal(calls.filter(({ url }) => url.includes("api.github.com")).length, 1);
  assert.equal(report.research.repositories[0].archived, true);
  assert.equal(report.research.repositories[0].attributionVerified, false);
  assert.match(report.research.repositoryCoverage, /not a code audit/);
});

test("cancelling a research check aborts in-flight provider requests without retrying", async () => {
  const controller = new AbortController();
  let started = 0, aborted = 0;
  const fetchImpl = async (_url, init) => new Promise((_resolve, reject) => {
    started++;
    init.signal.addEventListener("abort", () => { aborted++; reject(init.signal.reason); }, { once: true });
  });
  const pending = scanTarget(ADDRESS, { chain: "base", signal: controller.signal, fetchImpl });
  controller.abort(new DOMException("Cancelled", "AbortError"));
  await assert.rejects(pending, /Cancelled/);
  assert.ok(started >= 5);
  assert.equal(aborted, started);
});
test("private GitHub repository metadata is never published", async () => {
  const meta = metadata(); meta.data.attributes.websites = ["https://github.com/example/private"];
  const report = await scanTarget(ADDRESS, { chain: "base", fetchImpl: fetchFixture({meta,repository:{private:true,full_name:"example/private",archived:false,description:"private content"}}) });
  assert.equal(report.research.repositories.length,0);
  assert.equal(JSON.stringify(report).includes("private content"),false);
});
