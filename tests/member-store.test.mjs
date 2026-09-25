import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import { DEFAULT_MEMBER_PREFERENCES } from "../lib/member-rules.js";

const moduleSource = source => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
function tsModule(file, replacements = {}) {
  let source = readFileSync(new URL(file, import.meta.url), "utf8");
  for (const [from, to] of Object.entries(replacements)) source = source.replaceAll(JSON.stringify(from), JSON.stringify(to));
  return moduleSource(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
}
const workerUrl = moduleSource("export const env = { get DB() { return globalThis.__memberStoreDb; } };");
const { applyMemberAction, getMemberState, ensureMember } = await import(tsModule("../lib/member-store.ts", {
  "cloudflare:workers": workerUrl,
  "./member-rules.js": new URL("../lib/member-rules.js", import.meta.url).href,
  "./security": tsModule("../lib/security.ts"),
}));

const alice = { id: "solana:alice-test-wallet", walletAddress: "alice-test-wallet" };
const bob = { id: "solana:bob-test-wallet", walletAddress: "bob-test-wallet" };

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  for (const migration of ["0000_low_old_lace.sql", "0003_members.sql"]) {
    sqlite.exec(readFileSync(new URL(`../drizzle/${migration}`, import.meta.url), "utf8"));
  }
  // Runs the production SQL unchanged against SQLite, matching D1's prepare/bind/batch surface.
  function prepared(sql, parameters = []) {
    return {
      bind(...values) { return prepared(sql, values); },
      async first(column) {
        const row = sqlite.prepare(sql).get(...parameters);
        return row ? (column ? row[column] : { ...row }) : null;
      },
      async all() {
        const rows = sqlite.prepare(sql).all(...parameters).map(row => ({ ...row }));
        return { success: true, results: rows, meta: {} };
      },
      async run() {
        const result = sqlite.prepare(sql).run(...parameters);
        return { success: true, results: [], meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } };
      },
    };
  }
  const db = {
    prepare: prepared,
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  globalThis.__memberStoreDb = db;
  let sequence = 0;
  const report = (overrides = {}) => {
    const address = `0x${(++sequence).toString(16).padStart(40, "0")}`;
    const row = {
      id: crypto.randomUUID(), token_key: `ethereum:${address}`, address, chain: "ethereum",
      name: `Token ${sequence}`, symbol: `T${sequence}`, created_at: Date.now(), classification: "UNCLEAR",
      hidden: 0, ...overrides,
    };
    row.payload = overrides.payload ?? JSON.stringify({
      target: { address: row.address, chain: row.chain }, identity: { name: row.name, symbol: row.symbol },
      generatedAt: new Date(row.created_at).toISOString(),
      metrics: { priceUsd: sequence, liquidityUsd: 100000 }, sources: [{ name: "DEX market", ok: true }],
      findings: [], research: { market: { pairAddress: `pair-${sequence}` } },
    });
    sqlite.prepare("INSERT INTO reports(id,token_key,address,chain,name,symbol,created_at,classification,payload,hidden) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .run(row.id, row.token_key, row.address, row.chain, row.name, row.symbol, row.created_at, row.classification, row.payload, row.hidden);
    return row;
  };
  const alert = (member, savedReport, id = crypto.randomUUID()) => {
    sqlite.prepare("INSERT INTO member_alerts(id,member_id,title,body,report_id,created_at,read) VALUES(?,?,?,?,?,?,0)")
      .run(id, member.id, `${member.walletAddress} alert`, "A threshold changed.", savedReport.id, Date.now());
    return id;
  };
  const action = (member, body) => applyMemberAction(db, member, body);
  const state = member => getMemberState(db, member);
  return { sqlite, db, report, alert, action, state };
}

test("saved report libraries are private to the authenticated member", async () => {
  const f = fixture(), first = f.report(), second = f.report();
  await f.action(alice, { action: "saveReport", reportId: first.id, memberId: bob.id });
  await f.action(bob, { action: "saveReport", reportId: second.id });
  assert.deepEqual((await f.state(alice)).savedReports.map(report => report.id), [first.id]);
  assert.deepEqual((await f.state(bob)).savedReports.map(report => report.id), [second.id]);
  await f.action(alice, { action: "removeReport", reportId: second.id, memberId: bob.id });
  assert.deepEqual((await f.state(bob)).savedReports.map(report => report.id), [second.id]);
  await f.action(alice, { action: "removeReport", reportId: first.id });
  assert.equal((await f.state(alice)).savedReports.length, 0);
  f.sqlite.close();
});

test("shared tokens retain separate positions and monitoring controls for every member", async () => {
  const f = fixture(), shared = f.report(), bobOnly = f.report();
  for (const member of [alice, bob]) await f.action(member, { action: "addWatch", reportId: shared.id });
  await f.action(bob, { action: "addWatch", reportId: bobOnly.id });
  await f.action(alice, { action: "updatePosition", tokenKey: shared.token_key, quantity: 3.5, costBasisUsd: 12.25, memberId: bob.id });
  await f.action(alice, { action: "updateWatch", tokenKey: shared.token_key, monitorEnabled: false });
  await f.action(alice, { action: "updatePosition", tokenKey: bobOnly.token_key, quantity: 999, costBasisUsd: 999 });
  const aliceState = await f.state(alice), bobState = await f.state(bob);
  assert.equal(aliceState.watchlist.length, 1);
  assert.equal(aliceState.watchlist[0].quantity, 3.5);
  assert.equal(aliceState.watchlist[0].costBasisUsd, 12.25);
  assert.equal(aliceState.watchlist[0].monitorEnabled, false);
  for (const item of bobState.watchlist) {
    assert.equal(item.quantity, null); assert.equal(item.costBasisUsd, null); assert.equal(item.monitorEnabled, true);
  }
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM monitor_tokens").get().n, 2);
  await f.action(alice, { action: "removeWatch", tokenKey: shared.token_key });
  assert.equal((await f.state(alice)).watchlist.length, 0);
  assert.equal((await f.state(bob)).watchlist.length, 2);
  f.sqlite.close();
});

test("notification preferences and read status never change another account", async () => {
  const f = fixture(), report = f.report();
  for (const member of [alice, bob]) await ensureMember(f.db, member.id);
  const aliceAlert = f.alert(alice, report), bobAlert = f.alert(bob, report);
  const preferences = { ...DEFAULT_MEMBER_PREFERENCES, alertsEnabled: false, priceChangePct: 50, quietStart: "22:00", quietEnd: "07:00" };
  await f.action(alice, { action: "preferences", preferences, memberId: bob.id });
  assert.deepEqual((await f.state(alice)).preferences, preferences);
  assert.deepEqual((await f.state(bob)).preferences, DEFAULT_MEMBER_PREFERENCES);
  await f.action(alice, { action: "markRead", id: bobAlert });
  assert.equal((await f.state(bob)).notifications[0].read, false);
  assert.deepEqual((await f.state(alice)).notifications.map(alert => alert.id), [aliceAlert]);
  await f.action(alice, { action: "markRead", all: true });
  assert.equal((await f.state(alice)).notifications[0].read, true);
  assert.equal((await f.state(bob)).notifications[0].read, false);
  f.sqlite.close();
});

test("hidden reports cannot be saved or watched and disappear from every account surface", async () => {
  const f = fixture(), report = f.report(), hidden = f.report({ hidden: 1 });
  for (const member of [alice, bob]) {
    await f.action(member, { action: "saveReport", reportId: report.id });
    await f.action(member, { action: "addWatch", reportId: report.id });
    f.alert(member, report);
    await assert.rejects(f.action(member, { action: "saveReport", reportId: hidden.id }), /not available/);
    await assert.rejects(f.action(member, { action: "addWatch", reportId: hidden.id }), /not available/);
  }
  f.sqlite.prepare("UPDATE reports SET hidden=1 WHERE id=?").run(report.id);
  for (const member of [alice, bob]) {
    const state = await f.state(member);
    assert.equal(state.savedReports.length, 0);
    assert.equal(state.watchlist.length, 0);
    assert.equal(state.notifications.length, 0);
  }
  f.sqlite.close();
});

test("private saved libraries cap at 100 and remain idempotent at the limit", async () => {
  const f = fixture(), reports = Array.from({ length: 101 }, () => f.report());
  for (const report of reports.slice(0, 100)) await f.action(alice, { action: "saveReport", reportId: report.id });
  await f.action(alice, { action: "saveReport", reportId: reports[0].id });
  await assert.rejects(f.action(alice, { action: "saveReport", reportId: reports[100].id }), /100 reports/);
  await f.action(bob, { action: "saveReport", reportId: reports[100].id });
  assert.equal((await f.state(alice)).savedReports.length, 100);
  assert.equal((await f.state(bob)).savedReports.length, 1);
  await f.action(alice, { action: "removeReport", reportId: reports[0].id });
  await f.action(alice, { action: "saveReport", reportId: reports[100].id });
  assert.equal((await f.state(alice)).savedReports.length, 100);
  f.sqlite.close();
});

test("watchlists cap at 20 unique tokens without affecting another member's capacity", async () => {
  const f = fixture(), reports = Array.from({ length: 21 }, () => f.report());
  for (const report of reports.slice(0, 20)) await f.action(alice, { action: "addWatch", reportId: report.id });
  await f.action(alice, { action: "addWatch", reportId: reports[0].id });
  await assert.rejects(f.action(alice, { action: "addWatch", reportId: reports[20].id }), /20 tokens/);
  await f.action(bob, { action: "addWatch", reportId: reports[20].id });
  assert.equal((await f.state(alice)).watchlist.length, 20);
  assert.equal((await f.state(bob)).watchlist.length, 1);
  await f.action(alice, { action: "removeWatch", tokenKey: reports[0].token_key });
  await f.action(alice, { action: "addWatch", reportId: reports[20].id });
  assert.equal((await f.state(alice)).watchlist.length, 20);
  f.sqlite.close();
});

test("hidden unavailable reports do not leave a visibly empty account locked at capacity", async () => {
  const f = fixture(), reports = Array.from({ length: 101 }, () => f.report());
  for (const report of reports.slice(0, 100)) await f.action(alice, { action: "saveReport", reportId: report.id });
  for (const report of reports.slice(0, 20)) await f.action(alice, { action: "addWatch", reportId: report.id });
  f.sqlite.prepare("UPDATE reports SET hidden=1 WHERE id<>?").run(reports[100].id);
  assert.equal((await f.state(alice)).savedReports.length, 0);
  assert.equal((await f.state(alice)).watchlist.length, 0);
  await f.action(alice, { action: "saveReport", reportId: reports[100].id });
  await f.action(alice, { action: "addWatch", reportId: reports[100].id });
  assert.equal((await f.state(alice)).savedReports.length, 1);
  assert.equal((await f.state(alice)).watchlist.length, 1);
  f.sqlite.close();
});

test("watching a new visible report restores the same hidden token without losing its position or pause", async () => {
  const f = fixture(), old = f.report();
  await f.action(alice, { action: "addWatch", reportId: old.id });
  await f.action(alice, { action: "updatePosition", tokenKey: old.token_key, quantity: 4, costBasisUsd: 30 });
  await f.action(alice, { action: "updateWatch", tokenKey: old.token_key, monitorEnabled: false });
  f.sqlite.prepare("UPDATE reports SET hidden=1 WHERE id=?").run(old.id);
  const recent = f.report({ address: old.address, token_key: old.token_key });
  await f.action(alice, { action: "addWatch", reportId: recent.id });
  const watched = (await f.state(alice)).watchlist;
  assert.equal(watched.length, 1);
  assert.equal(watched[0].reportId, recent.id);
  assert.equal(watched[0].quantity, 4);
  assert.equal(watched[0].costBasisUsd, 30);
  assert.equal(watched[0].monitorEnabled, false);
  f.sqlite.close();
});

test("the shared 500-account token ceiling is atomic and includes paused or hidden subscriptions", async () => {
  const f = fixture(), report = f.report();
  const first = { id: "subscriber:0", walletAddress: "subscriber:0" };
  for (let index = 0; index < 499; index++) {
    const user = { id: `subscriber:${index}`, walletAddress: `subscriber:${index}` };
    await f.action(user, { action: "addWatch", reportId: report.id });
  }
  const attempts = await Promise.allSettled([
    f.action(alice, { action: "addWatch", reportId: report.id }),
    f.action(bob, { action: "addWatch", reportId: report.id }),
  ]);
  assert.equal(attempts.filter(result => result.status === "fulfilled").length, 1);
  const rejected = attempts.find(result => result.status === "rejected");
  assert.match(rejected.reason.message, /This token.*500 accounts/);
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM member_watches WHERE token_key=?").get(report.token_key).n, 500);
  await f.action(first, { action: "updateWatch", tokenKey: report.token_key, monitorEnabled: false });
  await f.action(first, { action: "addWatch", reportId: report.id });
  const late = { id: "subscriber:late", walletAddress: "subscriber:late" };
  await assert.rejects(f.action(late, { action: "addWatch", reportId: report.id }), /This token.*500 accounts/);
  f.sqlite.prepare("UPDATE reports SET hidden=1 WHERE id=?").run(report.id);
  const replacement = f.report({ address: report.address, token_key: report.token_key });
  await assert.rejects(f.action(late, { action: "addWatch", reportId: replacement.id }), /This token.*500 accounts/);
  await f.action(first, { action: "addWatch", reportId: replacement.id });
  assert.equal((await f.state(first)).watchlist[0].monitorEnabled, false);
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM member_watches WHERE token_key=?").get(report.token_key).n, 500);
  f.sqlite.close();
});

test("invalid position amounts are rejected without changing either field", async () => {
  const f = fixture(), report = f.report();
  await f.action(alice, { action: "addWatch", reportId: report.id });
  await f.action(alice, { action: "updatePosition", tokenKey: report.token_key, quantity: 2, costBasisUsd: 5 });
  for (const bad of [-1, NaN, Infinity, 1e15 + 1, "7", undefined, {}, []]) {
    await assert.rejects(f.action(alice, { action: "updatePosition", tokenKey: report.token_key, quantity: bad, costBasisUsd: 10 }), /non-negative/);
    await assert.rejects(f.action(alice, { action: "updatePosition", tokenKey: report.token_key, quantity: 10, costBasisUsd: bad }), /non-negative/);
  }
  const current = (await f.state(alice)).watchlist[0];
  assert.equal(current.quantity, 2); assert.equal(current.costBasisUsd, 5);
  await f.action(alice, { action: "updatePosition", tokenKey: report.token_key, quantity: 0, costBasisUsd: 0 });
  assert.equal((await f.state(alice)).watchlist[0].quantity, 0);
  await f.action(alice, { action: "updatePosition", tokenKey: report.token_key, quantity: null, costBasisUsd: "" });
  const cleared = (await f.state(alice)).watchlist[0];
  assert.equal(cleared.quantity, null); assert.equal(cleared.costBasisUsd, null);
  f.sqlite.close();
});

test("saved and watched reports must have a supported matching token identity", async () => {
  const f = fixture();
  const cases = [
    f.report({ token_key: "ethereum:wrong-address" }),
    f.report({ chain: "auto" }),
    f.report({ address: "0x123" }),
    f.report({ payload: "{}" }),
    f.report({ payload: "broken json" }),
    f.report({ payload: JSON.stringify({ target: { chain: "solana", address: "11111111111111111111111111111111" } }) }),
  ];
  for (const action of ["saveReport", "addWatch"]) {
    for (const report of cases) await assert.rejects(f.action(alice, { action, reportId: report.id }), /identity/);
    await assert.rejects(f.action(alice, { action, reportId: "malformed-id" }), /Choose/);
    await assert.rejects(f.action(alice, { action, reportId: crypto.randomUUID() }), /not available/);
  }
  assert.equal((await f.state(alice)).savedReports.length, 0);
  assert.equal((await f.state(alice)).watchlist.length, 0);
  f.sqlite.close();
});

test("deleting an account removes only that member's saved data and retains public reports", async () => {
  const f = fixture(), shared = f.report();
  for (const member of [alice, bob]) {
    await f.action(member, { action: "saveReport", reportId: shared.id });
    await f.action(member, { action: "addWatch", reportId: shared.id });
    await f.action(member, { action: "updatePosition", tokenKey: shared.token_key, quantity: 1, costBasisUsd: 5 });
    f.alert(member, shared);
  }
  await f.action(alice, { action: "deleteAccount", memberId: bob.id });
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM members WHERE id=?").get(alice.id).n, 0);
  for (const table of ["saved_reports", "member_watches", "member_alerts"]) {
    assert.equal(f.sqlite.prepare(`SELECT count(*) AS n FROM ${table} WHERE member_id=?`).get(alice.id).n, 0);
    assert.equal(f.sqlite.prepare(`SELECT count(*) AS n FROM ${table} WHERE member_id=?`).get(bob.id).n, 1);
  }
  const bobState = await f.state(bob);
  assert.equal(bobState.watchlist[0].quantity, 1);
  assert.equal(bobState.savedReports[0].id, shared.id);
  assert.equal(bobState.notifications.length, 1);
  assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM reports WHERE id=?").get(shared.id).n, 1);
  f.sqlite.close();
});
