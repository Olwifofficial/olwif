import test from "node:test";
import assert from "node:assert/strict";
import {DEFAULT_MEMBER_PREFERENCES, REPORT_ID, memberPreferences, positionNumber, monitorSnapshot, isQuietTime, monitorChanges} from "../lib/member-rules.js";

const preferences = overrides => ({...DEFAULT_MEMBER_PREFERENCES, ...overrides});
const snapshot = overrides => ({priceUsd: 100, liquidityUsd: 1000, poolAddress: "PoolAbCdefghijkmnopqrstuvwxyz123456789", light: "amber", warnings: [], checkedAt: "2026-09-24T12:00:00Z", ...overrides});
const report = overrides => ({generatedAt: "2026-09-24T12:00:00Z", target: {chain: "solana", address: "So11111111111111111111111111111111111111112"}, metrics: {priceUsd: 100, liquidityUsd: 1000}, sources: [{name: "DEX market", ok: true}], findings: [], research: {market: {pairAddress: "PoolAbCdefghijkmnopqrstuvwxyz123456789"}}, ...overrides});

test("alert preferences require real booleans, finite bounded thresholds and paired UTC times", () => {
  assert.deepEqual(memberPreferences(preferences()), DEFAULT_MEMBER_PREFERENCES);
  assert.deepEqual(memberPreferences(preferences({priceChangePct: 1000, liquidityDropPct: 100, quietStart: "22:30", quietEnd: "06:15"})), preferences({priceChangePct: 1000, liquidityDropPct: 100, quietStart: "22:30", quietEnd: "06:15"}));
  for (const invalid of [null, [], "settings", {}, preferences({alertsEnabled: 1}), preferences({riskChanges: "true"}), preferences({priceChangePct: "10"}), preferences({priceChangePct: NaN}), preferences({priceChangePct: Infinity}), preferences({priceChangePct: 0}), preferences({priceChangePct: 1001}), preferences({liquidityDropPct: 101}), preferences({liquidityDropPct: -1}), preferences({quietStart: "22:00"}), preferences({quietEnd: "07:00"}), preferences({quietStart: "24:00", quietEnd: "07:00"}), preferences({quietStart: "22:60", quietEnd: "07:00"}), preferences({quietStart: "7:00", quietEnd: "08:00"}), preferences({quietStart: "22:00", quietEnd: "22:00"})]) assert.throws(() => memberPreferences(invalid), /Invalid|Choose/);
});

test("private position amounts preserve zero and reject coercion, negatives and unsafe magnitudes", () => {
  assert.equal(positionNumber(null), null);
  assert.equal(positionNumber(""), null);
  for (const valid of [0, .000001, 123.45, 1e15]) assert.equal(positionNumber(valid), valid);
  for (const invalid of [undefined, "0", "1.25", " ", false, true, [], {}, NaN, Infinity, -Infinity, -1, 1e15 + 1]) assert.throws(() => positionNumber(invalid), /non-negative amount/);
});

test("report identifiers cannot escape their UUID shape", () => {
  assert.equal(REPORT_ID.test("0f23c3e8-1234-4def-9abc-a00123456789"), true);
  for (const invalid of ["", "../../account", "anything", "0f23c3e8-1234-4def-9abc-a00123456789/summary", "x' OR 1=1 --"]) assert.equal(REPORT_ID.test(invalid), false);
});

test("monitor snapshots require successful market evidence and keep unknown values distinct from observed zero", () => {
  const measured = monitorSnapshot(report());
  assert.equal(measured.priceUsd, 100);
  assert.equal(measured.liquidityUsd, 1000);
  assert.equal(measured.poolAddress, "PoolAbCdefghijkmnopqrstuvwxyz123456789");
  const zeros = monitorSnapshot(report({metrics: {priceUsd: 0, liquidityUsd: 0}, sources: [{name: "GeckoTerminal market", ok: true}]}));
  assert.equal(zeros.priceUsd, 0); assert.equal(zeros.liquidityUsd, 0);
  for (const sources of [[], [{name: "DEX market", ok: false}], [{name: "GeckoTerminal metadata", ok: true}], [{name: "DEX market", ok: "true"}]]) {
    const unavailable = monitorSnapshot(report({sources}));
    assert.equal(unavailable.priceUsd, null); assert.equal(unavailable.liquidityUsd, null);
  }
  for (const invalid of [null, undefined, "0", -1, Infinity, NaN]) {
    const unavailable = monitorSnapshot(report({metrics: {priceUsd: invalid, liquidityUsd: invalid}}));
    assert.equal(unavailable.priceUsd, null); assert.equal(unavailable.liquidityUsd, null);
  }
  const empty = monitorSnapshot({});
  assert.equal(empty.priceUsd, null); assert.equal(empty.liquidityUsd, null); assert.equal(empty.poolAddress, null); assert.equal(empty.checkedAt, null);
  assert.notEqual(empty.light, "green");
});

test("warning snapshots include hard failures, normalize duplicate codes and keep informational findings out", () => {
  const checked = monitorSnapshot(report({findings: [{code: "B_WARN", severity: "warn"}, {code: "A_DANGER", severity: "danger"}, {code: "B_WARN", severity: "warn"}, {code: "HARD_FAIL", severity: "good", hardFail: true}, {code: "CLEAR", severity: "good"}, {code: "UNKNOWN", severity: "unknown"}, {title: "Warning without a code", severity: "warn"}, null]}));
  assert.deepEqual(checked.warnings, ["A_DANGER", "B_WARN", "HARD_FAIL", "Warning without a code"]);
});

test("price alerts trigger at the threshold in either direction without rounding sub-threshold moves into alerts", () => {
  const before = snapshot();
  assert.match(monitorChanges(before, snapshot({priceUsd: 110})).join(" "), /Price up 10\.0%/);
  assert.match(monitorChanges(before, snapshot({priceUsd: 90})).join(" "), /Price down 10\.0%/);
  assert.deepEqual(monitorChanges(before, snapshot({priceUsd: 109.999})), []);
  assert.deepEqual(monitorChanges(before, snapshot({priceUsd: 90.001})), []);
  assert.match(monitorChanges(before, snapshot({priceUsd: 0})).join(" "), /Price down 100\.0%/);
});

test("liquidity alerts fire at the configured drop threshold and ignore increases", () => {
  const before = snapshot();
  assert.match(monitorChanges(before, snapshot({liquidityUsd: 800})).join(" "), /liquidity down 20\.0%/);
  assert.deepEqual(monitorChanges(before, snapshot({liquidityUsd: 800.01})), []);
  assert.deepEqual(monitorChanges(before, snapshot({liquidityUsd: 1200})), []);
  assert.match(monitorChanges(before, snapshot({liquidityUsd: 0})).join(" "), /liquidity down 100\.0%/);
});

test("extreme price observations cannot produce an infinite percentage alert", () => {
  assert.deepEqual(monitorChanges(snapshot({priceUsd: Number.MIN_VALUE}), snapshot({priceUsd: Number.MAX_VALUE})), []);
});

test("price and liquidity alerts need matching nonempty pool identities, including exact Solana casing", () => {
  const changed = snapshot({priceUsd: 50, liquidityUsd: 100});
  assert.equal(monitorChanges(snapshot(), changed).length, 2);
  for (const poolAddress of [null, undefined, "", "different-pool", snapshot().poolAddress.toLowerCase()]) assert.deepEqual(monitorChanges(snapshot({poolAddress}), changed), []);
  for (const poolAddress of [null, undefined, ""]) assert.deepEqual(monitorChanges(snapshot({poolAddress}), {...changed, poolAddress}), []);
});

test("missing market observations and zero baselines never manufacture percentage changes", () => {
  for (const unavailable of [null, undefined, "0", NaN, Infinity, -1]) {
    assert.deepEqual(monitorChanges(snapshot({priceUsd: unavailable, liquidityUsd: unavailable}), snapshot({priceUsd: 50, liquidityUsd: 100})), []);
    assert.deepEqual(monitorChanges(snapshot(), snapshot({priceUsd: unavailable, liquidityUsd: unavailable})), []);
  }
  assert.deepEqual(monitorChanges(snapshot({priceUsd: 0, liquidityUsd: 0}), snapshot({priceUsd: 50, liquidityUsd: 100})), []);
});

test("risk alerts use new warning codes and changed signals independently of market pool continuity", () => {
  const before = snapshot({warnings: ["OLD_WARNING"]});
  const after = snapshot({poolAddress: "different-pool", warnings: ["OLD_WARNING", "NEW_WARNING"], light: "red"});
  const changes = monitorChanges(before, after);
  assert.equal(changes.length, 2);
  assert.match(changes[0], /1 new warning in the latest check/);
  assert.match(changes[1], /from yellow to red/);
  assert.deepEqual(monitorChanges(before, snapshot({warnings: []})), [], "A removed warning is not described as a newly found warning");
  assert.deepEqual(monitorChanges(before, after, preferences({riskChanges: false})), []);
});

test("disabled alerts suppress market and research events; quiet hours leave inbox generation intact", () => {
  const before = snapshot(), after = snapshot({priceUsd: 50, liquidityUsd: 0, warnings: ["NEW"], light: "red"});
  assert.deepEqual(monitorChanges(before, after, preferences({alertsEnabled: false})), []);
  const quiet = preferences({quietStart: "22:00", quietEnd: "07:00"});
  assert.equal(monitorChanges(before, after, quiet).length, 4, "Quiet hours silence desktop delivery, not the stored inbox");
});

test("UTC quiet hours cover midnight and use an inclusive start with an exclusive end", () => {
  const overnight = preferences({quietStart: "22:00", quietEnd: "07:00"});
  for (const clock of ["22:00", "23:59", "00:00", "06:59"]) assert.equal(isQuietTime(overnight, Date.parse(`2026-09-24T${clock}:00Z`)), true, clock);
  for (const clock of ["07:00", "12:00", "21:59"]) assert.equal(isQuietTime(overnight, Date.parse(`2026-09-24T${clock}:00Z`)), false, clock);
  const daytime = preferences({quietStart: "09:30", quietEnd: "11:00"});
  assert.equal(isQuietTime(daytime, Date.parse("2026-09-24T10:30:00+01:00")), true, "09:30 UTC is the start, regardless of the input timestamp offset");
  assert.equal(isQuietTime(daytime, Date.parse("2026-09-24T12:00:00+01:00")), false, "11:00 UTC is the end");
  assert.equal(isQuietTime(preferences(), Date.parse("2026-09-24T23:00:00Z")), false);
});

test("snapshot, preference and alert calculations preserve their inputs and default settings", () => {
  const input = report({findings: [{code: "Z", severity: "warn"}, {code: "A", severity: "danger"}], research: {market: {pairAddress: "PoolAbCdefghijkmnopqrstuvwxyz123456789"}}});
  const before = snapshot({warnings: ["OLD"]}), after = snapshot({priceUsd: 50, warnings: ["OLD", "NEW"]}), settings = preferences({quietStart: "22:00", quietEnd: "07:00"});
  const original = structuredClone({input, before, after, settings, defaults: DEFAULT_MEMBER_PREFERENCES});
  monitorSnapshot(input); monitorChanges(before, after, settings); memberPreferences(settings); isQuietTime(settings, Date.parse("2026-09-24T23:00:00Z"));
  assert.deepEqual({input, before, after, settings, defaults: DEFAULT_MEMBER_PREFERENCES}, original);
  assert.equal(Object.isFrozen(DEFAULT_MEMBER_PREFERENCES), true);
});
