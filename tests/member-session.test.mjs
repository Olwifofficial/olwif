import test from "node:test";
import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import { MEMBER_SESSION_EVENT, publishMemberSession, watchMemberSession } from "../lib/member-session.js";

class SessionTarget extends EventTarget {
  listeners = new Map();
  addEventListener(type, listener, options) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
    super.addEventListener(type, listener, options);
  }
  removeEventListener(type, listener, options) {
    this.listeners.get(type)?.delete(listener);
    super.removeEventListener(type, listener, options);
  }
  listenerCount(type) { return this.listeners.get(type)?.size || 0; }
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function pendingFetches() {
  const calls = [];
  const fetchImpl = (url, options) => {
    const pending = deferred();
    calls.push({ url, options, ...pending });
    return pending.promise;
  };
  return { calls, fetchImpl };
}

const sessionEvent = detail => new CustomEvent(MEMBER_SESSION_EVENT, { detail });

test("watching the session immediately reads its server endpoint without prompting a wallet", async t => {
  const target = new SessionTarget(), { calls, fetchImpl } = pendingFetches(), changes = [];
  const stop = watchMemberSession(value => changes.push(value), { target, fetchImpl });
  t.after(stop);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/api/auth/session");
  assert.equal(calls[0].options.credentials, "same-origin");
  assert.equal(calls[0].options.cache, "no-store");
  assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.equal(calls[0].options.method, undefined, "Session reads use the default GET");
  assert.equal(calls[0].options.body, undefined);
  assert.deepEqual(changes, []);
  assert.equal(target.listenerCount("focus"), 1);
  assert.equal(target.listenerCount(MEMBER_SESSION_EVENT), 1);
  calls[0].resolve(Response.json({ authenticated: true, user: { id: "example-member" } }));
  await nextTurn();
  assert.deepEqual(changes, [true]);
});

test("only an explicit server boolean true marks the UI signed in", async () => {
  for (const [body, expected] of [
    [{ authenticated: true }, true], [{ authenticated: false }, false],
    [{ authenticated: "true" }, false], [{ authenticated: 1 }, false],
    [{ authenticated: null }, false], [{}, false], [null, false], [[], false],
  ]) {
    const changes = [], target = new SessionTarget();
    const stop = watchMemberSession(value => changes.push(value), { target, fetchImpl: async () => Response.json(body) });
    await nextTurn();
    assert.deepEqual(changes, [expected]);
    stop();
  }
});

test("session observation schedules no timers and does not poll after a successful read", async t => {
  const timeout = t.mock.method(globalThis, "setTimeout", () => 0);
  const interval = t.mock.method(globalThis, "setInterval", () => 0);
  const target = new SessionTarget(), changes = [];
  let requests = 0;
  const stop = watchMemberSession(value => changes.push(value), {
    target, fetchImpl: async () => { requests++; return Response.json({ authenticated: true }); },
  });
  t.after(stop);
  await nextTurn(); await nextTurn(); await nextTurn();
  target.dispatchEvent(new Event("blur"));
  target.dispatchEvent(new Event("unrelated"));
  await nextTurn();
  assert.equal(requests, 1);
  assert.deepEqual(changes, [true]);
  assert.equal(timeout.mock.callCount(), 0);
  assert.equal(interval.mock.callCount(), 0);
});

test("returning focus rechecks server state and can replace signed in with signed out", async t => {
  const target = new SessionTarget(), { calls, fetchImpl } = pendingFetches(), changes = [];
  const stop = watchMemberSession(value => changes.push(value), { target, fetchImpl });
  t.after(stop);
  calls[0].resolve(Response.json({ authenticated: true }));
  await nextTurn();
  target.dispatchEvent(new Event("focus"));
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.signal.aborted, true);
  assert.equal(calls[1].options.signal.aborted, false);
  calls[1].resolve(Response.json({ authenticated: false }));
  await nextTurn();
  assert.deepEqual(changes, [true, false]);
});

test("an authentication event aborts a stale fetch and cannot be overwritten by its late response", async t => {
  for (const authenticated of [true, false]) {
    const target = new SessionTarget(), { calls, fetchImpl } = pendingFetches(), changes = [];
    const stop = watchMemberSession(value => changes.push(value), { target, fetchImpl });
    t.after(stop);
    target.dispatchEvent(sessionEvent(authenticated));
    assert.equal(calls[0].options.signal.aborted, true);
    assert.deepEqual(changes, [authenticated]);
    assert.equal(calls.length, 1, "The event itself does not issue another request");
    // Deliberately ignore AbortSignal to model a response already in flight.
    calls[0].resolve(Response.json({ authenticated: !authenticated }));
    await nextTurn();
    assert.deepEqual(changes, [authenticated]);
    stop();
  }
});

test("a sign-out event also wins when a prior response is still parsing JSON", async t => {
  const target = new SessionTarget(), parsing = deferred(), changes = [];
  const stop = watchMemberSession(value => changes.push(value), {
    target, fetchImpl: async () => ({ ok: true, json: () => parsing.promise }),
  });
  t.after(stop);
  await nextTurn();
  target.dispatchEvent(sessionEvent(false));
  parsing.resolve({ authenticated: true });
  await nextTurn();
  assert.deepEqual(changes, [false]);
});

test("malformed events neither change authentication nor abort a legitimate pending read", async t => {
  const target = new SessionTarget(), { calls, fetchImpl } = pendingFetches(), changes = [];
  const stop = watchMemberSession(value => changes.push(value), { target, fetchImpl });
  t.after(stop);
  for (const detail of [undefined, null, "true", "false", 1, 0, {}, [], { authenticated: true }]) {
    target.dispatchEvent(sessionEvent(detail));
  }
  target.dispatchEvent(new Event(MEMBER_SESSION_EVENT));
  assert.deepEqual(changes, []);
  assert.equal(calls[0].options.signal.aborted, false);
  assert.equal(calls.length, 1);
  calls[0].resolve(Response.json({ authenticated: true }));
  await nextTurn();
  assert.deepEqual(changes, [true]);
});

test("repeated focus reads discard earlier results even when responses arrive out of order", async t => {
  const target = new SessionTarget(), { calls, fetchImpl } = pendingFetches(), changes = [];
  const stop = watchMemberSession(value => changes.push(value), { target, fetchImpl });
  t.after(stop);
  target.dispatchEvent(new Event("focus"));
  target.dispatchEvent(new Event("focus"));
  assert.equal(calls.length, 3);
  assert.equal(calls[0].options.signal.aborted, true);
  assert.equal(calls[1].options.signal.aborted, true);
  calls[2].resolve(Response.json({ authenticated: true }));
  await nextTurn();
  calls[1].resolve(Response.json({ authenticated: false }));
  calls[0].reject(new Error("Stale request failed late"));
  await nextTurn();
  assert.deepEqual(changes, [true]);
});

test("cleanup aborts the pending fetch, removes both listeners and suppresses late updates", async () => {
  const target = new SessionTarget(), { calls, fetchImpl } = pendingFetches(), changes = [];
  const stop = watchMemberSession(value => changes.push(value), { target, fetchImpl });
  stop(); stop();
  assert.equal(calls[0].options.signal.aborted, true);
  assert.equal(target.listenerCount("focus"), 0);
  assert.equal(target.listenerCount(MEMBER_SESSION_EVENT), 0);
  target.dispatchEvent(new Event("focus"));
  target.dispatchEvent(sessionEvent(true));
  calls[0].resolve(Response.json({ authenticated: true }));
  await nextTurn();
  assert.equal(calls.length, 1);
  assert.deepEqual(changes, []);
});

test("network failures, HTTP errors and invalid JSON fall back safely to signed out", async () => {
  const failures = [
    async () => { throw new Error("Simulated network outage"); },
    async () => Response.json({ authenticated: true }, { status: 401 }),
    async () => Response.json({ authenticated: true }, { status: 503 }),
    async () => new Response("not JSON", { status: 200 }),
  ];
  for (const fetchImpl of failures) {
    const target = new SessionTarget(), changes = [];
    const stop = watchMemberSession(value => changes.push(value), { target, fetchImpl });
    await nextTurn();
    assert.deepEqual(changes, [false]);
    stop();
  }
});

test("publishing emits boolean UI state and remains safe without a browser window", t => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  t.after(() => {
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else delete globalThis.window;
  });
  delete globalThis.window;
  assert.doesNotThrow(() => publishMemberSession(true));
  const target = new SessionTarget(), details = [];
  target.addEventListener(MEMBER_SESSION_EVENT, event => details.push(event.detail));
  Object.defineProperty(globalThis, "window", { configurable: true, value: target });
  publishMemberSession(true);
  publishMemberSession(false);
  publishMemberSession("true");
  assert.deepEqual(details, [true, false, false]);
});
