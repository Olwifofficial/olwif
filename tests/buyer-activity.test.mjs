import test from "node:test";
import assert from "node:assert/strict";
import { collectBuyerActivity } from "../lib/research/buyer-activity.js";

const TOKEN = `0x${"a".repeat(40)}`, QUOTE = `0x${"b".repeat(40)}`, POOL = `0x${"c".repeat(64)}`;
const WALLET = `0x${"d".repeat(40)}`, HASH = `0x${"e".repeat(64)}`;
const report = () => ({ target: { chain: "ethereum", address: TOKEN }, research: { market: { pairAddress: POOL, poolUrl: "https://private.example/?secret=never-fetch" } } });
const pool = () => ({ data: { type: "pool", id: `eth_${POOL}`, attributes: { address: POOL }, relationships: {
  base_token: { data: { type: "token", id: `eth_${TOKEN}` } }, quote_token: { data: { type: "token", id: `eth_${QUOTE}` } }
} } });
const row = (id = "eth_event_1", attrs = {}) => ({ type: "trade", id, attributes: {
  tx_hash: HASH, tx_from_address: WALLET, kind: "buy", from_token_address: QUOTE, to_token_address: TOKEN,
  from_token_amount: "10", to_token_amount: "20", price_from_in_usd: "1", price_to_in_usd: "0.5", volume_in_usd: "10",
  block_timestamp: new Date(Date.now() - 5000).toISOString(), ...attrs
} });
const ok = data => ({ ok: true, json: async () => data });
function fixture({ poolData = pool(), rows = [row()], response, error } = {}) {
  const calls = [];
  return { calls, fetchImpl: async (url, init) => {
    calls.push({ url, init });
    if (error) throw error;
    if (response) return response;
    return ok(url.endsWith("/trades") ? { data: rows } : poolData);
  } };
}

test("verifies the selected pool then reads only its public trade endpoint", async () => {
  const env = fixture(), input = report(), before = JSON.stringify(input);
  const data = await collectBuyerActivity(input, env);
  assert.equal(data.status, "available"); assert.equal(data.version, 1);
  assert.equal(data.source, "GeckoTerminal trades"); assert.equal(data.maxTrades, 300);
  assert.equal(data.trades.length, 1); assert.equal(data.poolAddress, POOL);
  assert.deepEqual(data.trades[0], { id: "eth_event_1", txHash: HASH, wallet: WALLET, side: "buy", tokenAmount: 20, priceUsd: .5, volumeUsd: 10, timestamp: data.windowStart });
  assert.equal(env.calls.length, 2);
  assert.equal(env.calls[0].url, `https://api.geckoterminal.com/api/v2/networks/eth/pools/${POOL}`);
  assert.equal(env.calls[1].url, data.sourceUrl);
  for (const { url, init } of env.calls) {
    assert.equal(init.method, "GET"); assert.equal(init.credentials, "omit"); assert.equal(init.redirect, "error");
    assert.equal(init.body, undefined); assert.deepEqual(init.headers, { Accept: "application/json" });
    assert.ok(init.signal instanceof AbortSignal); assert.doesNotMatch(url, /secret|key|cursor|trading_period/);
  }
  assert.equal(JSON.stringify(input), before);
});

test("unsupported networks, malformed addresses and missing pools cause no request", async () => {
  for (const input of [{}, { target: { chain: "unknown", address: TOKEN } }, { ...report(), target: { chain: "ethereum", address: `${TOKEN}?secret=x` } }, { ...report(), research: {} }, { ...report(), research: { market: { pairAddress: "https://localhost/pool" } } }]) {
    const env = fixture(), data = await collectBuyerActivity(input, env);
    assert.notEqual(data.status, "available"); assert.equal(env.calls.length, 0); assert.deepEqual(data.trades, []); assert.ok(data.reason);
    assert.equal(data.returnedTrades, undefined);
  }
});

test("mismatched pool, network, base token or missing quote stops before the trade request", async () => {
  const mutations = [
    p => { p.data.id = `base_${POOL}`; }, p => { p.data.id = `eth_0x${"f".repeat(64)}`; },
    p => { p.data.attributes.address = `0x${"f".repeat(64)}`; }, p => { p.data.type = "token"; },
    p => { p.data.relationships.base_token.data.id = `eth_${QUOTE}`; },
    p => { p.data.relationships.base_token.data.id = `base_${TOKEN}`; },
    p => { p.data.relationships.quote_token = null; }
  ];
  for (const mutate of mutations) {
    const payload = pool(); mutate(payload); const env = fixture({ poolData: payload });
    const data = await collectBuyerActivity(report(), env);
    assert.equal(data.status, "unavailable"); assert.deepEqual(data.trades, []); assert.equal(env.calls.length, 1);
  }
});

test("EVM addresses compare case-insensitively and quote/base direction confirms each side", async () => {
  const input = report(); input.target.address = `0x${"A".repeat(40)}`;
  const env = fixture({ rows: [row("eth_buy", { tx_from_address: `0x${"D".repeat(40)}` }), row("eth_sell", { kind: "sell", from_token_address: TOKEN, to_token_address: QUOTE, from_token_amount: "3", price_from_in_usd: ".7", volume_in_usd: "2.1" })] });
  const data = await collectBuyerActivity(input, env);
  assert.equal(data.status, "available"); assert.equal(data.address, TOKEN);
  assert.deepEqual(data.trades.map(t => [t.side, t.tokenAmount, t.priceUsd]), [["buy", 20, .5], ["sell", 3, .7]]);
  assert.equal(data.trades[0].wallet, WALLET);
});

test("wrong token, countertoken, direction, sender or transaction hash rows are rejected", async () => {
  const invalid = [
    { to_token_address: WALLET }, { from_token_address: WALLET }, { kind: "sell" },
    { tx_from_address: "<script>" }, { tx_from_address: `0x${"0".repeat(40)}` }, { tx_hash: "https://private.example/?secret=raw" }
  ];
  const env = fixture({ rows: [row("eth_good"), ...invalid.map((attrs, i) => row(`eth_bad_${i}`, attrs))] });
  const data = await collectBuyerActivity(report(), env);
  assert.deepEqual(data.trades.map(t => t.id), ["eth_good"]); assert.equal(data.rejectedTrades, invalid.length);
  assert.doesNotMatch(JSON.stringify(data), /<script>|secret=raw/);
});

test("invalid numbers become unknown fields without removing verified trade direction", async () => {
  const invalid = ["", " ", true, null, -1, 0, "Infinity", "1e999", "0x20", {}, []];
  for (const [field, output] of [["to_token_amount", "tokenAmount"], ["price_to_in_usd", "priceUsd"]]) {
    const env = fixture({ rows: invalid.map((value, i) => row(`eth_invalid_${i}`, { [field]: value })) });
    const data = await collectBuyerActivity(report(), env);
    assert.equal(data.status, "available"); assert.equal(data.trades.length, invalid.length);
    assert.equal(data.rejectedTrades, 0);
    assert.ok(data.trades.every(trade => trade.side === "buy" && trade[output] === null));
  }
  const env = fixture({ rows: [row("eth_invalid_volume", { volume_in_usd: false })] });
  const data = await collectBuyerActivity(report(), env);
  assert.equal(data.status, "available"); assert.equal(data.trades[0].volumeUsd, null);
});

test("a missing-price buy and missing-amount sell remain visible for honest buyer classification", async () => {
  const rows = [
    row("eth_buy_without_price", { price_to_in_usd: undefined, volume_in_usd: null }),
    row("eth_sell_without_amount", { kind: "sell", from_token_address: TOKEN, to_token_address: QUOTE, from_token_amount: null, price_from_in_usd: undefined })
  ];
  const data = await collectBuyerActivity(report(), fixture({ rows }));
  assert.equal(data.status, "available"); assert.equal(data.trades.length, 2); assert.equal(data.rejectedTrades, 0);
  assert.deepEqual(data.trades.map(({ wallet, side, tokenAmount, priceUsd }) => ({ wallet, side, tokenAmount, priceUsd })), [
    { wallet: WALLET, side: "buy", tokenAmount: 20, priceUsd: null },
    { wallet: WALLET, side: "sell", tokenAmount: null, priceUsd: null }
  ]);
});

test("future, stale and malformed timestamps are rejected and usable rows are oldest first", async () => {
  const now = Date.now();
  const rows = [row("eth_newer", { block_timestamp: new Date(now - 3000).toISOString() }), row("eth_older", { block_timestamp: new Date(now - 6000).toISOString() }),
    ...[new Date(now + 120000).toISOString(), new Date(now - 26 * 3600000).toISOString(), "not-a-date", null, "2026-02-31T10:00:00Z"].map((time, i) => row(`eth_bad_time_${i}`, { block_timestamp: time }))];
  const data = await collectBuyerActivity(report(), fixture({ rows }));
  assert.deepEqual(data.trades.map(t => t.id), ["eth_older", "eth_newer"]);
  assert.equal(data.rejectedTrades, 5); assert.equal(data.windowStart, data.trades[0].timestamp); assert.equal(data.windowEnd, data.trades[1].timestamp);
});

test("deduplicates event IDs, retains separate events in one transaction, and drops conflicting duplicates", async () => {
  const first = row("eth_first"), conflict = row("eth_conflict");
  const data = await collectBuyerActivity(report(), fixture({ rows: [first, structuredClone(first), row("eth_other_same_tx"), conflict, { ...conflict, attributes: { ...conflict.attributes, to_token_amount: "999" } }] }));
  assert.deepEqual(data.trades.map(t => t.id), ["eth_first", "eth_other_same_tx"]);
  assert.equal(data.duplicateTrades, 2); assert.equal(data.rejectedTrades, 1);
  assert.equal(new Set(data.trades.map(t => t.txHash)).size, 1);
});

test("an invalid conflicting event cannot leave a valid-looking copy in the saved sample", async () => {
  const valid = row("eth_conflicting");
  const invalid = { ...valid, attributes: { ...valid.attributes, to_token_address: WALLET } };
  for (const rows of [[valid, invalid], [invalid, valid]]) {
    const data = await collectBuyerActivity(report(), fixture({ rows }));
    assert.equal(data.status, "unavailable"); assert.deepEqual(data.trades, []);
  }
});

test("only the first 300 returned trades are used and no pagination request is made", async () => {
  const env = fixture({ rows: Array.from({ length: 305 }, (_, i) => row(`eth_event_${String(i).padStart(3, "0")}`)) });
  const data = await collectBuyerActivity(report(), env);
  assert.equal(data.trades.length, 300); assert.equal(data.returnedTrades, 300); assert.equal(data.truncated, true); assert.equal(env.calls.length, 2);
});

test("an actual empty list is distinguished from a failed or malformed trade lookup", async () => {
  const empty = await collectBuyerActivity(report(), fixture({ rows: [] }));
  assert.equal(empty.status, "available"); assert.equal(empty.returnedTrades, 0); assert.equal(empty.windowStart, null);
  const env = fixture({ rows: null }), data = await collectBuyerActivity(report(), env);
  assert.equal(data.status, "unavailable"); assert.deepEqual(data.trades, []); assert.ok(data.reason); assert.equal(data.returnedTrades, undefined);
});

test("blocked, busy, missing and broken sources give static unavailable reasons without a fallback", async () => {
  for (const status of [401, 402, 403, 404, 429, 500]) {
    const env = fixture({ response: { ok: false, status, json: async () => { throw new Error("private response"); } } });
    const data = await collectBuyerActivity(report(), env);
    assert.equal(data.status, "unavailable"); assert.deepEqual(data.trades, []); assert.ok(data.reason); assert.equal(env.calls.length, 1);
    assert.doesNotMatch(JSON.stringify(data), /private response/);
  }
  const env = fixture({ error: new Error("private-key-secret") }), data = await collectBuyerActivity(report(), env);
  assert.equal(data.status, "unavailable"); assert.doesNotMatch(JSON.stringify(data), /private-key-secret/);
});

test("a failed trade request after successful verification is unavailable, never a zero count", async () => {
  const calls = [];
  const fetchImpl = async url => {
    calls.push(url);
    return url.endsWith("/trades") ? { ok: false, status: 429 } : ok(pool());
  };
  const data = await collectBuyerActivity(report(), { fetchImpl });
  assert.equal(calls.length, 2); assert.equal(data.status, "unavailable");
  assert.deepEqual(data.trades, []); assert.equal(data.returnedTrades, undefined); assert.ok(data.reason);
});

test("a provider timeout is unavailable while user cancellation propagates", async () => {
  const waitingFetch = async (_url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
  const timedOut = await collectBuyerActivity(report(), { fetchImpl: waitingFetch, timeoutMs: 100 });
  assert.equal(timedOut.status, "unavailable"); assert.match(timedOut.reason, /time limit/);
  const controller = new AbortController();
  const pending = collectBuyerActivity(report(), { fetchImpl: waitingFetch, signal: controller.signal });
  controller.abort(); await assert.rejects(pending, { name: "AbortError" });
  const env = fixture(); await assert.rejects(collectBuyerActivity(report(), { ...env, signal: controller.signal }), { name: "AbortError" });
  assert.equal(env.calls.length, 0);
});

test("Solana preserves base58 case and accepts only matching pool/token and sender/signature shapes", async () => {
  const token = "So11111111111111111111111111111111111111112", quote = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", selectedPool = "58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2";
  const input = { target: { chain: "solana", address: token }, research: { market: { pairAddress: selectedPool } } };
  const poolData = { data: { type: "pool", id: `solana_${selectedPool}`, attributes: { address: selectedPool }, relationships: { base_token: { data: { type: "token", id: `solana_${token}` } }, quote_token: { data: { type: "token", id: `solana_${quote}` } } } } };
  const attrs = { tx_hash: "2".repeat(88), tx_from_address: token, from_token_address: quote, to_token_address: token };
  const data = await collectBuyerActivity(input, fixture({ poolData, rows: [row("solana_valid", attrs), row("solana_bad_case", { ...attrs, to_token_address: token.toLowerCase() }), row("solana_bad_signature", { ...attrs, tx_hash: "0".repeat(88) })] }));
  assert.equal(data.status, "available"); assert.equal(data.trades.length, 1); assert.equal(data.trades[0].wallet, token); assert.equal(data.rejectedTrades, 2);
  const mismatch = structuredClone(poolData); mismatch.data.relationships.base_token.data.id = `solana_${token.toLowerCase()}`;
  const env = fixture({ poolData: mismatch }); assert.equal((await collectBuyerActivity(input, env)).status, "unavailable"); assert.equal(env.calls.length, 1);
});
