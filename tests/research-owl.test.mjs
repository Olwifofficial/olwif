import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
// Compile the actual components in memory; no test-only production route or dependency.
function loadComponent(path, resolve = require) {
  const { outputText } = ts.transpileModule(source(path), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", outputText)(resolve, module, module.exports);
  return module.exports.default;
}
const ResearchOwl = loadComponent("../components/research-owl.tsx");
const owlMarkup = () => renderToStaticMarkup(React.createElement(ResearchOwl, { onCancel() {} }));

test("busy companion exposes one polite status and keeps its decorative art out of the accessibility tree", () => {
  const html = owlMarkup();
  assert.equal((html.match(/role="status"/g) || []).length, 1);
  assert.match(html, /role="status" aria-live="polite">O’s on the case…/);
  assert.match(html, /class="research-owl-track" aria-hidden="true"/);
  assert.match(html, /<svg\b[^>]*focusable="false"/);
  assert.match(html, /class="research-owl-paper research-owl-paper-front"/);
  assert.match(html, /class="research-owl-paper research-owl-paper-back"/);
  assert.doesNotMatch(html, /45 seconds|\d+%/);
});

test("cancel remains a named non-submit button wired directly to the request cancellation callback", () => {
  const Component = loadComponent("../components/research-owl.tsx", (name) => name === "react" ? { ...React, useId: () => "test-owl", useState: (initial) => [initial, () => {}] } : require(name));
  let cancellations = 0;
  const tree = Component({ onCancel: () => cancellations++ });
  function findButton(node) {
    if (!node || typeof node !== "object") return null;
    if (node.type === "button") return node;
    for (const child of React.Children.toArray(node.props?.children)) {
      const found = findButton(child);
      if (found) return found;
    }
    return null;
  }
  const button = findButton(tree);
  assert.ok(button);
  assert.equal(button.props.type, "button");
  assert.equal(button.props["aria-label"], "Cancel token check");
  button.props.onClick();
  assert.equal(cancellations, 1);
});

test("multiple owl instances keep independent SVG gradient identifiers", () => {
  const html = renderToStaticMarkup(React.createElement(React.Fragment, null,
    React.createElement(ResearchOwl, { onCancel() {} }),
    React.createElement(ResearchOwl, { onCancel() {} }),
  ));
  const ids = [...html.matchAll(/<linearGradient id="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(ids.length, 4);
  assert.equal(new Set(ids).size, 4);
  for (const id of ids) assert.ok(html.includes(`url(#${id})`));
});

function deskMarkup(busy) {
  let stateIndex = 0;
  const plain = (tag) => ({ children }) => React.createElement(tag, null, children);
  const icon = () => React.createElement("svg", { "aria-hidden": true });
  const Component = loadComponent("../app/research-desk.tsx", (name) => {
    if (name === "react") return {
      ...React,
      useState: (initial) => [stateIndex++ === 2 ? busy : initial, () => {}],
      useEffect: () => {},
      useRef: () => ({ current: null }),
      useCallback: (fn) => fn,
    };
    if (name === "react/jsx-runtime") return require(name);
    if (name === "lucide-react") return { ArrowUpRight: icon, Search: icon, LoaderCircle: icon };
    if (name === "@/components/ui/button") return { Button: ({ children, ...props }) => React.createElement("button", props, children) };
    if (name === "@/components/ui/input") return { Input: (props) => React.createElement("input", props) };
    if (name === "@/components/ui/select") return Object.fromEntries(["Select", "SelectContent", "SelectItem", "SelectTrigger", "SelectValue"].map((key) => [key, plain("div")]));
    if (name === "./site-shell") return { __esModule: true, default: plain("div") };
    if (name === "@/components/research-owl") return { __esModule: true, default: ResearchOwl };
    if (name === "@/components/supported-networks") return { __esModule: true, default: () => React.createElement("div", {className:"supported-networks"}) };
    if (name === "@/lib/security") return { NETWORKS: ["auto", "solana", "base"] };
    throw new Error(`Unexpected component dependency: ${name}`);
  });
  return renderToStaticMarkup(React.createElement(Component));
}

test("homepage mounts the owl only while busy, retains disabled controls, and has no idle animation DOM", () => {
  const idle = deskMarkup(false);
  const busy = deskMarkup(true);
  assert.doesNotMatch(idle, /research-loading|research-owl-scene/);
  assert.match(idle, /aria-busy="false"/);
  assert.match(busy, /data-testid="research-loading"/);
  assert.match(busy, /aria-busy="true"/);
  assert.match(busy, /<input\b[^>]*disabled=""/);
  assert.match(busy, /aria-label="Checking token"[^>]*disabled=""/);
  assert.doesNotMatch(busy, /45 seconds/);
});

test("animation is CSS-only and reduced-motion users retain a static companion", () => {
  const component = source("../components/research-owl.tsx");
  const css = source("../app/globals.css");
  assert.doesNotMatch(component, /\b(?:setInterval|setTimeout|requestAnimationFrame|fetch|useEffect)\s*\(/);
  assert.match(css, /@keyframes owl-trot-along/);
  assert.match(css, /@keyframes owl-flip-paper/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\.research-loading[^}]*animation:\s*none\s*!important/);
  assert.match(owlMarkup(), /data-motion="auto"/);
  assert.match(owlMarkup(), /aria-pressed="false">Animate O/);
  assert.match(css, /\.research-motion-toggle\s*\{\s*display: none/);
  assert.match(css, /\.research-loading\[data-motion="on"\] \.research-owl-runner\s*\{\s*animation: owl-trot-along/);
});

test("reduced-motion animation opt-in can be switched on and off without cancelling research", () => {
  let motion = false;
  const Component = loadComponent("../components/research-owl.tsx", (name) => name === "react" ? {
    ...React, useId: () => "test-owl", useState: () => [motion, (update) => { motion = update(motion); }],
  } : require(name));
  function toggle(node) {
    if (!node || typeof node !== "object") return null;
    if (node.type === "button" && node.props.className === "research-motion-toggle") return node;
    return React.Children.toArray(node.props?.children).map(toggle).find(Boolean);
  }
  const props = { onCancel() { assert.fail("Animation toggle must not cancel a check"); } };
  toggle(Component(props)).props.onClick();
  assert.equal(motion, true);
  const running = Component(props);
  assert.equal(running.props["data-motion"], "on");
  assert.equal(toggle(running).props.children, "Pause animation");
  toggle(running).props.onClick();
  assert.equal(motion, false);
});

test("busy animation wiring preserves abort-on-cancel, abort-on-unmount, and finally cleanup", () => {
  const desk = source("../app/research-desk.tsx");
  assert.match(desk, /busy\s*&&\s*<ResearchOwl\s+onCancel=\{\(\)\s*=>\s*pending\.current\?\.abort\(\)/);
  assert.match(desk, /useEffect\(\(\)=>\(\)=>pending\.current\?\.abort\(\),\[\]\)/);
  assert.match(desk, /finally\{clearTimeout\(timer\);pending\.current=null;setBusy\(false\);\}/);
});
