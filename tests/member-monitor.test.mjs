import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import ts from "typescript";
import { DEFAULT_MEMBER_PREFERENCES, monitorSnapshot } from "../lib/member-rules.js";

const moduleSource = source => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
function tsModule(file, replacements = {}) {
  let source = readFileSync(new URL(file, import.meta.url), "utf8");
  for (const [from, to] of Object.entries(replacements)) source = source.replaceAll(JSON.stringify(from), JSON.stringify(to));
  return moduleSource(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
}
const storeUrl = moduleSource("export const memberDb = () => globalThis.__monitorFixture.db;");
const serverUrl = moduleSource(`
  export const runtime = name => globalThis.__monitorFixture.runtime[name] || '';
  export const getSettings = async () => globalThis.__monitorFixture.settings;
  export async function consumeLimit(key, maximum, period) {
    const f = globalThis.__monitorFixture;
    f.limitCalls.push({key, maximum, period});
    return f.limitResults[key] !== false;
  }
`);
const scannerUrl = moduleSource(`
  export async function scanTarget(address, options) {
    const f = globalThis.__monitorFixture;
    f.scans.push({address, options});
    return f.scan(address, options);
  }
`);
const fetchUrl = moduleSource(`
  export function sourceFetch() {
    return () => { throw new Error('External network is forbidden in monitor tests'); };
  }
`);
const { runMemberMonitor, monitoringStatus } = await import(tsModule("../lib/member-monitor.ts", {
  "./member-store": storeUrl, "./member-rules.js": new URL("../lib/member-rules.js", import.meta.url).href,
  "./server": serverUrl, "./source-fetch": fetchUrl, "./research/analyzer.js": scannerUrl,
  "./security": tsModule("../lib/security.ts"),
}));

const member = name => ({ id: `private-member:${name}`, preferences: { ...DEFAULT_MEMBER_PREFERENCES } });
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  for (const migration of ["0000_low_old_lace.sql", "0003_members.sql"]) {
    sqlite.exec(readFileSync(new URL(`../drizzle/${migration}`, import.meta.url), "utf8"));
  }
  const f = {
    sqlite, settings: { enabled: true, notice: "", disabledSources: [] },
    runtime: { OLWIF_BACKGROUND_MONITORING: "true" }, scans: [], limitCalls: [], limitResults: {},
    beforeFirst: null, beforeBatch: null, beforeRun: null,
    queryCount: 0, maxBoundParameters: 0, batchCalls: 0,
  };
  function prepared(sql, parameters = []) {
    return {
      bind(...values) { f.maxBoundParameters = Math.max(f.maxBoundParameters, values.length); return prepared(sql, values); },
      async first(column) {
        if (f.beforeFirst) await f.beforeFirst(sql, parameters);
        f.queryCount++;
        const row = sqlite.prepare(sql).get(...parameters);
        return row ? (column ? row[column] : { ...row }) : null;
      },
      async all() { f.queryCount++; return { success: true, results: sqlite.prepare(sql).all(...parameters).map(row => ({ ...row })), meta: {} }; },
      async run() {
        if (f.beforeRun) await f.beforeRun(sql, parameters);
        f.queryCount++;
        const result = sqlite.prepare(sql).run(...parameters);
        return { success: true, results: [], meta: { changes: result.changes, last_row_id: Number(result.lastInsertRowid) } };
      },
    };
  }
  f.db = {
    prepare: prepared,
    async batch(statements) {
      f.batchCalls++;
      if (f.beforeBatch) await f.beforeBatch(statements);
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  f.makeReport = (address, chain = "ethereum", patch = {}) => ({
    target: { address, chain, input: `https://source.example/token/${address}?tracking=discard-this` },
    identity: { name: "Public example token", symbol: "PUBLIC" }, generatedAt: new Date().toISOString(),
    metrics: { priceUsd: 120, liquidityUsd: 50000 }, sources: [{ name: "DEX market", ok: true }], findings: [],
    research: { classification: "Checks incomplete", market: { pairAddress: `pool:${chain}:${address}` }, unknowns: ["Research incomplete"], concerns: [] },
    ...patch,
  });
  f.scan = async (address, options) => f.makeReport(address, options.chain);
  let sequence = 0;
  f.token = (patch = {}) => {
    const address = `0x${(++sequence).toString(16).padStart(40, "0")}`;
    const token = {
      address, chain: "ethereum", token_key: `ethereum:${address}`, report_id: crypto.randomUUID(),
      last_checked_at: Date.now() - 20 * 60000, last_attempt_at: 0, lease_until: 0, ...patch,
    };
    const report = f.makeReport(token.address, token.chain, {
      metrics: { priceUsd: 100, liquidityUsd: 100000 }, generatedAt: new Date(token.last_checked_at).toISOString(),
    });
    token.snapshot = JSON.stringify(monitorSnapshot(report));
    sqlite.prepare("INSERT INTO reports(id,token_key,address,chain,name,symbol,created_at,classification,payload,hidden) VALUES(?,?,?,?,?,?,?,?,?,0)")
      .run(token.report_id, token.token_key, token.address, token.chain, report.identity.name, report.identity.symbol, token.last_checked_at, report.research.classification, JSON.stringify(report));
    sqlite.prepare("INSERT INTO monitor_tokens(token_key,address,chain,report_id,snapshot,last_checked_at,last_attempt_at,lease_until) VALUES(?,?,?,?,?,?,?,?)")
      .run(token.token_key, token.address, token.chain, token.report_id, token.snapshot, token.last_checked_at, token.last_attempt_at, token.lease_until);
    return token;
  };
  f.subscribe = (user, token, patch = {}) => {
    const row = { reportId: token.report_id, monitorEnabled: 1, baseline: token.snapshot, quantity: 928374.125, costBasisUsd: 823746.25, ...patch };
    sqlite.prepare("INSERT INTO members(id,preferences,created_at) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING")
      .run(user.id, JSON.stringify(user.preferences), Date.now());
    sqlite.prepare("INSERT INTO member_watches(member_id,token_key,report_id,quantity,cost_basis_usd,monitor_enabled,baseline,created_at) VALUES(?,?,?,?,?,?,?,?)")
      .run(user.id, token.token_key, row.reportId, row.quantity, row.costBasisUsd, row.monitorEnabled, row.baseline, Date.now());
  };
  f.watch = (user, token) => sqlite.prepare("SELECT * FROM member_watches WHERE member_id=? AND token_key=?").get(user.id, token.token_key);
  f.current = token => sqlite.prepare("SELECT * FROM monitor_tokens WHERE token_key=?").get(token.token_key);
  f.alerts = user => sqlite.prepare("SELECT * FROM member_alerts WHERE member_id=?").all(user.id);
  f.reportCount = () => sqlite.prepare("SELECT count(*) AS n FROM reports").get().n;
  globalThis.__monitorFixture = f;
  return f;
}

test("a due check saves public evidence, retains private positions and releases its lease", async () => {
  const f = fixture(), alice = member("alice"), token = f.token();
  f.subscribe(alice, token);
  const result = await runMemberMonitor({ memberId: alice.id });
  assert.equal(result.checked, 1);
  assert.equal(f.scans.length, 1);
  assert.equal(f.scans[0].address, token.address);
  assert.equal(f.scans[0].options.chain, token.chain);
  assert.equal(f.scans[0].options.timeoutMs, 4000);
  assert.ok(f.scans[0].options.signal instanceof AbortSignal);
  assert.equal(f.reportCount(), 2);
  const current = f.current(token), stored = f.sqlite.prepare("SELECT * FROM reports WHERE id=?").get(current.report_id);
  assert.notEqual(current.report_id, token.report_id);
  assert.ok(current.last_checked_at > token.last_checked_at);
  assert.equal(current.lease_until, 0);
  const report = JSON.parse(stored.payload);
  assert.equal(report.target.input, token.address);
  assert.equal(report.research.webResearch.status, "not_requested");
  assert.equal(JSON.parse(current.snapshot).priceUsd, 120);
  assert.doesNotMatch(stored.payload, /private-member|928374\.125|823746\.25|quantity|costBasis|preferences|quietStart|tracking=discard/);
  const watch = f.watch(alice, token);
  assert.equal(watch.report_id, current.report_id);
  assert.equal(watch.quantity, 928374.125);
  assert.equal(watch.cost_basis_usd, 823746.25);
  assert.equal(f.alerts(alice).length, 1);
  assert.match(f.alerts(alice)[0].body, /Price up 20\.0%/);
  assert.match(f.alerts(alice)[0].body, /liquidity down 50\.0%/);
  f.sqlite.close();
});

test("shared checks fan out using each owner's thresholds and skip paused and hidden watches", async () => {
  const f = fixture(), token = f.token();
  const alice = member("alice"), bob = member("bob"), muted = member("muted"), paused = member("paused"), hidden = member("hidden");
  bob.preferences = { ...bob.preferences, priceChangePct: 50, liquidityDropPct: 80, riskChanges: false };
  muted.preferences.alertsEnabled = false;
  for (const user of [alice, bob, muted]) f.subscribe(user, token);
  f.subscribe(paused, token, { monitorEnabled: 0 });
  const hiddenReport = crypto.randomUUID();
  f.sqlite.prepare("INSERT INTO reports SELECT ?,token_key,address,chain,name,symbol,created_at,classification,payload,1 FROM reports WHERE id=?").run(hiddenReport, token.report_id);
  f.subscribe(hidden, token, { reportId: hiddenReport });
  f.scan = async (address, options) => f.makeReport(address, options.chain, { findings: [{ severity: "warn", code: "NEW_WARNING", title: "New public warning" }] });
  assert.equal((await runMemberMonitor({ memberId: alice.id })).checked, 1);
  const current = f.current(token);
  assert.equal(f.alerts(alice).length, 1);
  assert.match(f.alerts(alice)[0].body, /1 new warning/);
  for (const user of [bob, muted, paused, hidden]) assert.equal(f.alerts(user).length, 0, user.id);
  for (const user of [alice, bob, muted]) assert.equal(f.watch(user, token).report_id, current.report_id);
  assert.equal(f.watch(paused, token).report_id, token.report_id);
  assert.equal(f.watch(paused, token).baseline, token.snapshot);
  assert.equal(f.watch(hidden, token).report_id, hiddenReport);
  assert.equal(f.watch(hidden, token).baseline, token.snapshot);
  f.sqlite.close();
});

test("missing market fields and failed market evidence cannot manufacture price or liquidity alerts", async () => {
  for (const patch of [{ metrics: {} }, { metrics: { priceUsd: null, liquidityUsd: null } }, { sources: [{ name: "DEX market", ok: false }] }]) {
    const f = fixture(), alice = member("alice"), token = f.token();
    alice.preferences.riskChanges = false;
    f.subscribe(alice, token);
    f.scan = async (address, options) => f.makeReport(address, options.chain, patch);
    assert.equal((await runMemberMonitor({ memberId: alice.id })).checked, 1);
    const snapshot = JSON.parse(f.current(token).snapshot);
    assert.equal(snapshot.priceUsd, null);
    assert.equal(snapshot.liquidityUsd, null);
    assert.equal(f.alerts(alice).length, 0);
    f.sqlite.close();
  }
});

test("a changed pool or absent baseline never compares unrelated market amounts", async () => {
  for (const baseline of ["{}", JSON.stringify({ priceUsd: 100, liquidityUsd: 100000, poolAddress: "another-pool" }), "not-json"]) {
    const f = fixture(), alice = member("alice"), token = f.token();
    alice.preferences.riskChanges = false;
    f.subscribe(alice, token, { baseline });
    assert.equal((await runMemberMonitor({ memberId: alice.id })).checked, 1);
    assert.equal(f.alerts(alice).length, 0);
    assert.equal(JSON.parse(f.watch(alice, token).baseline).priceUsd, 120);
    f.sqlite.close();
  }
});

test("an overlapping caller cannot fetch a token while its first check holds the lease", async () => {
  const f = fixture(), alice = member("alice"), token = f.token();
  f.subscribe(alice, token);
  const scanning = deferred(), release = deferred();
  f.scan = async (address, options) => { scanning.resolve(); await release.promise; return f.makeReport(address, options.chain); };
  const first = runMemberMonitor({ memberId: alice.id });
  await scanning.promise;
  const second = await runMemberMonitor({ memberId: alice.id });
  assert.equal(second.checked, 0);
  assert.equal(f.scans.length, 1);
  release.resolve();
  assert.equal((await first).checked, 1);
  assert.equal(f.current(token).lease_until, 0);
  f.sqlite.close();
});

test("a delayed lease contender rechecks freshness after the first runner completes", async () => {
  const f = fixture(), alice = member("alice"), token = f.token();
  f.subscribe(alice, token);
  const release = deferred();
  let leaseAttempts = 0;
  f.beforeFirst = async sql => {
    if (sql.startsWith("UPDATE monitor_tokens SET lease_until=?,last_attempt_at=?") && ++leaseAttempts === 2) await release.promise;
  };
  const first = runMemberMonitor({ memberId: alice.id });
  const delayed = runMemberMonitor({ memberId: alice.id });
  assert.equal((await first).checked, 1);
  assert.equal(leaseAttempts, 2, "Both runners selected the same previously due token");
  release.resolve();
  assert.equal((await delayed).checked, 0);
  assert.equal(f.scans.length, 1);
  assert.equal(f.reportCount(), 2);
  f.sqlite.close();
});

test("source failures keep the last successful report, snapshot and positions and release the lease", async () => {
  const f = fixture(), alice = member("alice"), token = f.token();
  f.subscribe(alice, token);
  f.scan = async () => { throw new Error("Simulated source outage"); };
  assert.equal((await runMemberMonitor({ memberId: alice.id })).checked, 0);
  const current = f.current(token);
  assert.equal(current.report_id, token.report_id);
  assert.equal(current.snapshot, token.snapshot);
  assert.equal(current.last_checked_at, token.last_checked_at);
  assert.ok(current.last_attempt_at > 0);
  assert.equal(current.lease_until, 0);
  assert.equal(f.watch(alice, token).quantity, 928374.125);
  assert.equal(f.watch(alice, token).baseline, token.snapshot);
  assert.equal(f.alerts(alice).length, 0);
  assert.equal(f.reportCount(), 1);
  assert.equal((await runMemberMonitor({ memberId: alice.id })).checked, 0);
  assert.equal(f.scans.length, 1, "The one-minute failure cooldown prevents an immediate retry");
  f.sqlite.close();
});

test("disabled scheduled checks and owner-paused checks never fetch", async () => {
  const f = fixture(), alice = member("alice"), token = f.token();
  f.subscribe(alice, token);
  f.runtime.OLWIF_BACKGROUND_MONITORING = "false";
  assert.equal((await runMemberMonitor({ scheduled: true })).checked, 0);
  assert.equal(f.scans.length, 0);
  assert.equal(f.limitCalls.length, 0);
  assert.equal((await monitoringStatus()).active, false);
  assert.equal(f.sqlite.prepare("SELECT value FROM settings WHERE key='monitor-heartbeat'").get(), undefined);
  f.settings.enabled = false;
  assert.equal((await runMemberMonitor({ memberId: alice.id })).checked, 0);
  assert.equal(f.scans.length, 0);
  f.sqlite.close();
});

test("scheduled heartbeat is reported only when scheduling is enabled and recent", async () => {
  const f = fixture();
  assert.equal((await monitoringStatus()).active, false);
  assert.equal((await runMemberMonitor({ scheduled: true })).checked, 0);
  assert.equal((await monitoringStatus()).active, true);
  f.sqlite.prepare("UPDATE settings SET value=? WHERE key='monitor-heartbeat'").run(String(Date.now() - 36 * 60000));
  assert.equal((await monitoringStatus()).active, false);
  f.sqlite.close();
});

test("the same token address returned on another chain is rejected without saving or alerting", async () => {
  const f = fixture(), alice = member("alice"), token = f.token();
  f.subscribe(alice, token);
  f.scan = async address => f.makeReport(address, "base");
  assert.equal((await runMemberMonitor({ memberId: alice.id })).checked, 0);
  assert.equal(f.reportCount(), 1);
  assert.equal(f.current(token).report_id, token.report_id);
  assert.equal(f.current(token).snapshot, token.snapshot);
  assert.equal(f.current(token).lease_until, 0);
  assert.equal(f.alerts(alice).length, 0);
  f.sqlite.close();
});

test("each invocation checks at most one due token belonging to the requesting member", async () => {
  const f = fixture(), alice = member("alice"), bob = member("bob");
  const other = f.token({ last_checked_at: Date.now() - 60 * 60000 });
  const oldest = f.token({ last_checked_at: Date.now() - 40 * 60000 });
  const next = f.token({ last_checked_at: Date.now() - 20 * 60000 });
  f.subscribe(bob, other); f.subscribe(alice, oldest); f.subscribe(alice, next);
  assert.equal((await runMemberMonitor({ memberId: alice.id })).checked, 1);
  assert.equal(f.scans.length, 1);
  assert.equal(f.scans[0].address, oldest.address);
  assert.equal(f.current(other).report_id, other.report_id);
  assert.equal(f.current(next).report_id, next.report_id);
  assert.equal((await runMemberMonitor({ memberId: alice.id })).checked, 1);
  assert.equal(f.scans.length, 2);
  assert.equal(f.scans[1].address, next.address);
  assert.equal((await runMemberMonitor({ memberId: alice.id })).checked, 0);
  assert.equal(f.scans.length, 2);
  f.sqlite.close();
});

test("daily and global shared allowances stop fetching and still release the token lease", async () => {
  for (const blocked of ["member-monitor-day", "research-global"]) {
    const f = fixture(), alice = member("alice"), token = f.token();
    f.subscribe(alice, token); f.limitResults[blocked] = false;
    const result = await runMemberMonitor({ memberId: alice.id });
    assert.equal(result.checked, 0);
    assert.match(result.message, /shared check allowance/);
    assert.equal(f.scans.length, 0);
    assert.equal(f.reportCount(), 1);
    assert.equal(f.current(token).report_id, token.report_id);
    assert.equal(f.current(token).lease_until, 0);
    assert.equal(f.alerts(alice).length, 0);
    assert.deepEqual(f.limitCalls[0], { key: "member-monitor-day", maximum: 96, period: 86400000 });
    assert.equal(f.limitCalls.length, blocked === "member-monitor-day" ? 1 : 2);
    f.sqlite.close();
  }
});

test("an aborted caller cannot publish a late source response", async () => {
  const f = fixture(), alice = member("alice"), token = f.token();
  f.subscribe(alice, token);
  const controller = new AbortController();
  f.scan = async (address, options) => { controller.abort(); return f.makeReport(address, options.chain); };
  assert.equal((await runMemberMonitor({ memberId: alice.id, signal: controller.signal })).checked, 0);
  assert.equal(f.reportCount(), 1);
  assert.equal(f.current(token).lease_until, 0);
  assert.equal(f.alerts(alice).length, 0);
  f.sqlite.close();
});

test("500 subscriptions fan out with the same bounded query and parameter count as one", async () => {
  const counts = [];
  for (const size of [1, 500]) {
    const f = fixture(), token = f.token();
    for (let index = 0; index < size; index++) f.subscribe(member(`subscriber-${index}`), token);
    assert.equal((await runMemberMonitor({ scheduled: true })).checked, 1);
    assert.equal(f.scans.length, 1);
    assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM member_alerts").get().n, size);
    const current = f.current(token);
    assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM member_watches WHERE report_id=?").get(current.report_id).n, size);
    assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM member_watches WHERE quantity=? AND cost_basis_usd=?").get(928374.125, 823746.25).n, size);
    const payload = f.sqlite.prepare("SELECT payload FROM reports WHERE id=?").get(current.report_id).payload;
    assert.doesNotMatch(payload, /private-member|subscriber-|928374\.125|823746\.25|memberId/);
    // Include the mocked settings read and two quota writes conservatively.
    assert.ok(f.queryCount + 1 + f.limitCalls.length <= 20, "Leave ample room below D1 Free's 50-query limit");
    assert.ok(f.maxBoundParameters <= 12, "JSON binding avoids a parameter per subscriber");
    assert.equal(f.batchCalls, 1, "Report, alerts, baselines and shared snapshot commit together");
    assert.equal(current.lease_until, 0);
    counts.push(f.queryCount);
    f.sqlite.close();
  }
  assert.equal(counts[1], counts[0], "SQL statement count must stay constant as subscriptions grow");
});

test("bulk commit rechecks subscribers paused, deleted or hidden after recipients were selected", async () => {
  const f = fixture(), token = f.token();
  const active = member("active"), paused = member("paused"), deleted = member("deleted"), hidden = member("hidden");
  for (const user of [active, paused, deleted]) f.subscribe(user, token);
  const hiddenReportId = crypto.randomUUID();
  f.sqlite.prepare("INSERT INTO reports SELECT ?,token_key,address,chain,name,symbol,created_at,classification,payload,0 FROM reports WHERE id=?").run(hiddenReportId, token.report_id);
  f.subscribe(hidden, token, { reportId: hiddenReportId });
  f.beforeBatch = async () => {
    f.sqlite.prepare("UPDATE member_watches SET monitor_enabled=0 WHERE member_id=?").run(paused.id);
    f.sqlite.prepare("DELETE FROM member_watches WHERE member_id=?").run(deleted.id);
    f.sqlite.prepare("DELETE FROM members WHERE id=?").run(deleted.id);
    f.sqlite.prepare("UPDATE reports SET hidden=1 WHERE id=?").run(hiddenReportId);
  };
  assert.equal((await runMemberMonitor({ memberId: active.id })).checked, 1);
  const current = f.current(token);
  assert.equal(f.alerts(active).length, 1);
  assert.equal(f.watch(active, token).report_id, current.report_id);
  for (const user of [paused, deleted, hidden]) assert.equal(f.alerts(user).length, 0);
  assert.equal(f.watch(paused, token).report_id, token.report_id);
  assert.equal(f.watch(paused, token).baseline, token.snapshot);
  assert.equal(f.watch(deleted, token), undefined);
  assert.equal(f.watch(hidden, token).report_id, hiddenReportId);
  assert.equal(f.watch(hidden, token).baseline, token.snapshot);
  f.sqlite.close();
});

test("a failed bulk commit rolls back public report, every alert and every private baseline", async () => {
  const f = fixture(), token = f.token(), alice = member("alice"), bob = member("bob");
  f.subscribe(alice, token); f.subscribe(bob, token);
  f.beforeRun = async sql => {
    if (sql.startsWith("UPDATE monitor_tokens SET report_id=")) throw new Error("Simulated database failure after fan-out statements");
  };
  assert.equal((await runMemberMonitor({ memberId: alice.id })).checked, 0);
  assert.equal(f.reportCount(), 1);
  for (const user of [alice, bob]) {
    assert.equal(f.alerts(user).length, 0);
    assert.equal(f.watch(user, token).report_id, token.report_id);
    assert.equal(f.watch(user, token).baseline, token.snapshot);
  }
  assert.equal(f.current(token).report_id, token.report_id);
  assert.equal(f.current(token).snapshot, token.snapshot);
  assert.equal(f.current(token).lease_until, 0);
  f.sqlite.close();
});

test("a runner that lost its lease cannot publish or clear another runner's lease", async () => {
  const f = fixture(), token = f.token(), alice = member("alice");
  f.subscribe(alice, token);
  let replacementLease;
  f.beforeBatch = async () => {
    replacementLease = f.current(token).lease_until + 90000;
    f.sqlite.prepare("UPDATE monitor_tokens SET lease_until=? WHERE token_key=?").run(replacementLease, token.token_key);
  };
  const result = await runMemberMonitor({ memberId: alice.id });
  assert.equal(result.checked, 0);
  assert.match(result.message, /Another check took over/);
  assert.equal(f.reportCount(), 1);
  assert.equal(f.alerts(alice).length, 0);
  assert.equal(f.watch(alice, token).baseline, token.snapshot);
  assert.equal(f.current(token).snapshot, token.snapshot);
  assert.equal(f.current(token).lease_until, replacementLease);
  f.sqlite.close();
});
