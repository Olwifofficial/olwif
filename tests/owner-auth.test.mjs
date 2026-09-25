import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const moduleSource = source => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const fixtureKey = "__olwifOwnerAuthFixture";
const workerModule = moduleSource(`export const env = new Proxy({}, {
  get(_target, name) { return globalThis.${fixtureKey}.bindings[name]; }
});`);
const headersModule = moduleSource(`export async function headers() {
  const fixture = globalThis.${fixtureKey};
  fixture.headerReads++;
  if (fixture.failOnHeaderRead) throw new Error("Identity headers must not be read");
  return new Headers(fixture.headers);
}`);
const navigationModule = moduleSource(`export function redirect(path) {
  throw Object.assign(new Error("Redirect"), { location: path });
}`);
let source = readFileSync(new URL("../app/chatgpt-auth.ts", import.meta.url), "utf8");
for (const [specifier, stub] of [
  ["cloudflare:workers", workerModule], ["next/headers", headersModule],
  ["next/navigation", navigationModule],
]) source = source.replaceAll(JSON.stringify(specifier), JSON.stringify(stub));
const auth = await import(moduleSource(ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText));

const identityHeaders = {
  "oai-authenticated-user-id": "example-owner-id",
  "oai-authenticated-user-email": "owner@example.com",
};

function fixture(t, { binding, processValue, headers = identityHeaders, failOnHeaderRead = false } = {}) {
  const previous = process.env.OLWIF_TRUSTED_AUTH_PROXY;
  const previousFixture = globalThis[fixtureKey];
  if (processValue === undefined) delete process.env.OLWIF_TRUSTED_AUTH_PROXY;
  else process.env.OLWIF_TRUSTED_AUTH_PROXY = processValue;
  const state = {
    bindings: { OLWIF_TRUSTED_AUTH_PROXY: binding }, headers, failOnHeaderRead, headerReads: 0,
  };
  globalThis[fixtureKey] = state;
  t.after(() => {
    if (previous === undefined) delete process.env.OLWIF_TRUSTED_AUTH_PROXY;
    else process.env.OLWIF_TRUSTED_AUTH_PROXY = previous;
    if (previousFixture === undefined) delete globalThis[fixtureKey];
    else globalThis[fixtureKey] = previousFixture;
  });
  return state;
}

test("owner identity defaults to signed out without reading spoofed headers", async t => {
  const state = fixture(t, { failOnHeaderRead: true });
  assert.equal(await auth.getChatGPTUser(), null);
  assert.equal(state.headerReads, 0);
  await assert.rejects(auth.requireChatGPTUser("/admin"), error =>
    error.location === "/signin-with-chatgpt?return_to=%2Fadmin");
  assert.equal(state.headerReads, 0);
});

test("only the exact string true enables owner identity", async t => {
  const state = fixture(t, { failOnHeaderRead: true });
  for (const value of [false, true, 0, 1, "", "false", "TRUE", "True", " true", "true ", "1"]) {
    state.bindings.OLWIF_TRUSTED_AUTH_PROXY = value;
    assert.equal(await auth.getChatGPTUser(), null, `binding ${JSON.stringify(value)}`);
  }
  state.bindings.OLWIF_TRUSTED_AUTH_PROXY = undefined;
  for (const value of ["", "false", "TRUE", "True", " true", "true ", "1"]) {
    process.env.OLWIF_TRUSTED_AUTH_PROXY = value;
    assert.equal(await auth.getChatGPTUser(), null, `process value ${JSON.stringify(value)}`);
  }
  assert.equal(state.headerReads, 0);
});

test("Cloudflare configuration takes precedence over process environment", async t => {
  const state = fixture(t, { binding: "false", processValue: "true", failOnHeaderRead: true });
  assert.equal(await auth.getChatGPTUser(), null);
  state.bindings.OLWIF_TRUSTED_AUTH_PROXY = "";
  assert.equal(await auth.getChatGPTUser(), null);
  state.bindings.OLWIF_TRUSTED_AUTH_PROXY = false;
  assert.equal(await auth.getChatGPTUser(), null);
  assert.equal(state.headerReads, 0);

  state.bindings.OLWIF_TRUSTED_AUTH_PROXY = "true";
  process.env.OLWIF_TRUSTED_AUTH_PROXY = "false";
  state.failOnHeaderRead = false;
  assert.equal((await auth.getChatGPTUser()).userId, "example-owner-id");
  assert.equal(state.headerReads, 1);
});

test("missing Cloudflare binding falls back to an explicitly enabled process environment", async t => {
  const state = fixture(t, { processValue: "true" });
  assert.deepEqual(await auth.getChatGPTUser(), {
    userId: "example-owner-id", email: "owner@example.com", displayName: "owner@example.com", fullName: null,
  });
  state.bindings.OLWIF_TRUSTED_AUTH_PROXY = null;
  assert.equal((await auth.getChatGPTUser()).userId, "example-owner-id");
  assert.equal(state.headerReads, 2);
});

test("enabled owner identity still requires both ID and email headers", async t => {
  const state = fixture(t, { binding: "true" });
  for (const headers of [{}, { "oai-authenticated-user-id": "example-owner-id" },
    { "oai-authenticated-user-email": "owner@example.com" },
    { ...identityHeaders, "oai-authenticated-user-id": "" },
    { ...identityHeaders, "oai-authenticated-user-email": "" }]) {
    state.headers = headers;
    assert.equal(await auth.getChatGPTUser(), null);
  }
});

test("enabled owner identity decodes a declared UTF-8 full name safely", async t => {
  const fullName = "Example \u00c9lodie";
  const state = fixture(t, { binding: "true", headers: {
    ...identityHeaders,
    "oai-authenticated-user-full-name": encodeURIComponent(fullName),
    "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
  } });
  assert.deepEqual(await auth.getChatGPTUser(), {
    userId: "example-owner-id", email: "owner@example.com", displayName: fullName, fullName,
  });
  for (const headers of [
    { ...state.headers, "oai-authenticated-user-full-name-encoding": "unknown" },
    { ...state.headers, "oai-authenticated-user-full-name": "%E0%A4%A" },
  ]) {
    state.headers = headers;
    const user = await auth.getChatGPTUser();
    assert.equal(user.fullName, null);
    assert.equal(user.displayName, "owner@example.com");
  }
});
