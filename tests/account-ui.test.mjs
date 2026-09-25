import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import ts from "typescript";
import {isQuietTime} from "../lib/member-rules.js";
import {watchMemberSession, publishMemberSession} from "../lib/member-session.js";

const require = createRequire(import.meta.url);
function load(path, stubs = {}) {
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  const {outputText} = ts.transpileModule(source, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true}});
  const compiled = {exports: {}};
  const dependencies = {"@/lib/member-rules.js": {isQuietTime}, "@/lib/member-session.js": {watchMemberSession, publishMemberSession}, ...stubs};
  new Function("require", "module", "exports", outputText)(name => Object.hasOwn(dependencies, name) ? dependencies[name] : require(name), compiled, compiled.exports);
  return compiled.exports;
}
const {detectedWallets, safeReturnTo, authenticateWallet, positionValue, desktopUpdates} = load("../app/account/account-desk.tsx");
const reportId = "7bf2b300-649f-4103-bd7b-adfce81cd9e9";
const wallet = "So11111111111111111111111111111111111111112";
const provider = () => ({publicKey: {toString: () => wallet}, connect: async () => ({publicKey: {toString: () => wallet}}), signMessage: async () => ({signature: new Uint8Array(64).fill(7)})});

test("wallet discovery requires connect and signing, and deduplicates injected aliases", () => {
  const phantom = provider(), solflare = provider();
  const result = detectedWallets({phantom: {solana: phantom}, solana: phantom, solflare, backpack: {solana: {connect() {}}}});
  assert.deepEqual(result.map(item => item.name), ["Phantom", "Solflare"]);
  assert.deepEqual(detectedWallets({}), []);
});

test("sign-in return destinations only accept local UUID report paths", () => {
  assert.equal(safeReturnTo(`/report/${reportId}`), `/report/${reportId}`);
  for (const bad of [null, "", "//attacker.test", "https://attacker.test", "/report/../../admin", "/report/%2e%2e", "/report/not-an-id", `/report/${reportId}?next=https://attacker.test`, `/report/${reportId}#ignored`, "\\attacker.test"]) assert.equal(safeReturnTo(bad), null);
});

test("wallet authentication signs exact server text and verifies a base64 signature without sending a transaction", async t => {
  const calls = [], stages = [], message = "OLWIF sign-in\nOne-use nonce: example";
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({url, ...options, data: options.body ? JSON.parse(options.body) : null});
    return Response.json(url.endsWith("challenge") ? {message, challengeId: "nonce-id"} : {authenticated: true});
  });
  const injected = provider();
  for (const method of ["signTransaction", "signAllTransactions", "sendTransaction", "signAndSendTransaction"]) injected[method] = () => {assert.fail("Account access must not request a transaction");};
  injected.signMessage = async (bytes, encoding) => {
    assert.equal(new TextDecoder().decode(bytes), message);
    assert.equal(encoding, "utf8");
    return {signature: new Uint8Array(64).fill(7)};
  };
  await authenticateWallet(injected, new AbortController().signal, message => stages.push(message));
  assert.deepEqual(calls.map(item => item.url), ["/api/auth/challenge", "/api/auth/verify"]);
  assert.equal(calls[0].data.address, wallet);
  assert.deepEqual(Object.keys(calls[0].data), ["address"]);
  assert.deepEqual(Object.keys(calls[1].data).sort(), ["address", "challengeId", "signature"]);
  assert.equal(calls[1].data.challengeId, "nonce-id");
  assert.equal(calls[1].data.signature, Buffer.alloc(64, 7).toString("base64"));
  assert.ok(calls.every(item => item.credentials === "same-origin" && item.cache === "no-store"));
  assert.equal(stages.length, 3);
});

test("cancelling the wallet prompt never sends a challenge or verification", async t => {
  const abort = new AbortController();
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {calls++; return Response.json({});});
  const injected = provider();
  injected.connect = async () => {abort.abort(); return {publicKey: injected.publicKey};};
  await assert.rejects(authenticateWallet(injected, abort.signal, () => {}), {name: "AbortError"});
  assert.equal(calls, 0);
});

test("wallet changes and invalid signatures never reach verification", async t => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async url => {calls.push(url); return Response.json({message: "Sign in", challengeId: "id"});});
  const changed = provider();
  changed.signMessage = async () => {changed.publicKey = {toString: () => "different-wallet"}; return new Uint8Array(64);};
  await assert.rejects(authenticateWallet(changed, new AbortController().signal, () => {}), /address changed/);
  const malformed = provider();
  malformed.signMessage = async () => ({signature: new Uint8Array(32)});
  await assert.rejects(authenticateWallet(malformed, new AbortController().signal, () => {}), /unsupported signature/);
  assert.deepEqual(calls, ["/api/auth/challenge", "/api/auth/challenge"]);
});

test("a rejected verification remains an authentication error", async t => {
  t.mock.method(globalThis, "fetch", async url => url.endsWith("challenge") ? Response.json({message: "Sign in", challengeId: "id"}) : Response.json({error: "Sign-in message expired."}, {status: 401}));
  await assert.rejects(authenticateWallet(provider(), new AbortController().signal, () => {}), /Sign-in message expired/);
});

test("portfolio estimates keep missing prices and quantities distinct from zero", () => {
  assert.equal(positionValue({quantity: 4, latestPriceUsd: 2.5}), 10);
  assert.equal(positionValue({quantity: 0, latestPriceUsd: 2.5}), 0);
  for (const values of [{quantity: null, latestPriceUsd: 0}, {quantity: 0, latestPriceUsd: null}, {quantity: -1, latestPriceUsd: 2}, {quantity: 1e308, latestPriceUsd: 1e308}]) assert.equal(positionValue(values), null);
});

test("desktop delivery respects UTC quiet hours, disabled alerts and the initial inbox baseline", () => {
  const preferences = {alertsEnabled: true, priceChangePct: 10, liquidityDropPct: 20, riskChanges: true, quietStart: "22:00", quietEnd: "07:00"};
  const alerts = [{id: "old", read: false}, {id: "new", read: false}, {id: "read", read: true}];
  const seen = new Set(["old"]);
  assert.deepEqual(desktopUpdates(alerts, null, preferences, Date.parse("2026-09-24T12:00:00Z")), []);
  for (const time of ["2026-09-24T23:00:00Z", "2026-09-25T06:59:00Z"]) assert.deepEqual(desktopUpdates(alerts, seen, preferences, Date.parse(time)), []);
  assert.deepEqual(desktopUpdates(alerts, seen, preferences, Date.parse("2026-09-25T07:00:00Z")), [alerts[1]]);
  assert.deepEqual(desktopUpdates(alerts, seen, {...preferences, alertsEnabled: false}, Date.parse("2026-09-25T12:00:00Z")), []);
  const updatedBaseline = new Set(alerts.map(item => item.id));
  assert.deepEqual(desktopUpdates(alerts, updatedBaseline, preferences, Date.parse("2026-09-25T12:00:00Z")), [], "A suppressed update is not replayed after quiet hours");
});

function renderWithState(states) {
  let index = 0;
  const Component = load("../app/account/account-desk.tsx", {react: {...React, useState: initial => [index < states.length ? states[index++] : (index++, initial), () => {}]}}).default;
  return renderToStaticMarkup(React.createElement(Component));
}

test("signed-out account offers real wallet sign-in and clearly unavailable rewards", () => {
  const html = renderWithState([null, false, false, [], "", "", "", false, false]);
  assert.match(html, /No Solana wallet detected yet/);
  assert.match(html, /Your keys\. Your wallet\./);
  assert.match(html, /private keys and recovery phrase stay with you/);
  assert.match(html, /do not authorise transactions, spending approvals or access to move your funds/);
  assert.match(html, /public wallet address and a signed message proving you control it/);
  assert.match(html, /Cancel any request to send funds, approve spending or share your recovery phrase/);
  assert.doesNotMatch(html, /100% safe|cannot be stolen|guaranteed safe|Sign up \/ Sign in/);
  assert.match(html, /token and signup reward campaign have not launched/);
  assert.doesNotMatch(html, /Claim.*bonus|\$20|Send funds|type="password"/);
});

test("account navigation has one wallet entry and switches to My account for an authenticated session", () => {
  for (const authenticated of [false, true]) {
    const Nav = load("../components/account-nav.tsx", {react: {...React, useState: () => [authenticated, () => {}]}}).default;
    const html = renderToStaticMarkup(React.createElement(Nav));
    assert.equal((html.match(/<a /g) || []).length, 1);
    assert.match(html, authenticated ? /href="\/account"/ : /href="\/account#connect-wallet"/);
    assert.match(html, authenticated ? /My account/ : /Connect wallet/);
    assert.match(html, /Your keys\. Your wallet\./);
    assert.doesNotMatch(html, /Sign up|Sign in/);
  }
});

test("available wallets use a single Connect wallet action with reassurance before the prompt", () => {
  const html = renderWithState([null, false, false, [{name: "Phantom", provider: provider()}], "Phantom", "", "", false, false]);
  assert.match(html, /Connect wallet<\/button>/);
  assert.doesNotMatch(html, /Connect wallet &amp; sign in/);
  assert.ok(html.indexOf("Your keys. Your wallet.") < html.indexOf('id="wallet-choice"'));
});

test("private dashboard escapes token names, preserves zero values and gives explicit monitoring and notification limits", () => {
  const member = {authenticated: true, walletAddress: wallet,
    savedReports: [{id: reportId, name: '<script>alert("token")</script>', symbol: "EX", chain: "solana", address: wallet, createdAt: "2026-09-24T12:00:00Z"}],
    watchlist: [{tokenKey: `solana:${wallet}`, reportId, name: "Example", symbol: "EX", chain: "solana", address: wallet, quantity: 0, costBasisUsd: 0, latestPriceUsd: null, lastCheckedAt: null, monitorEnabled: true}],
    notifications: [], preferences: {alertsEnabled: true, priceChangePct: 10, liquidityDropPct: 20, riskChanges: true, quietStart: "", quietEnd: ""},
    monitoring: {active: false, message: "Check your watchlist when you visit. Automatic monitoring is not active."}, rewards: {enabled: false, message: "No rewards campaign is open."}};
  const html = renderWithState([member, false, false, [], "", "", "", false, false]);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /<dt>Your tokens<\/dt><dd>0<\/dd>/);
  assert.match(html, /<dt>Estimated holding value<\/dt><dd>Not available<\/dd>/);
  assert.match(html, /Automatic monitoring is not active/);
  assert.match(html, /Email and closed-browser push are not available yet/);
  assert.match(html, /Quiet hours \(UTC\)/);
  assert.match(html, /No rewards campaign is open/);
  assert.match(html, new RegExp(`href="/report/${reportId}"`));
});
