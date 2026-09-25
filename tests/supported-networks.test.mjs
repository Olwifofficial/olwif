import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

function loadModule(path, resolve = require) {
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
  return module.exports;
}

const security = loadModule("../lib/security.ts");
const SupportedNetworks = loadModule("../components/supported-networks.tsx", (name) =>
  name === "@/lib/security" ? security : require(name)
).default;
const markup = () => renderToStaticMarkup(React.createElement(SupportedNetworks));
const names = ["Solana", "Ethereum", "Base", "BNB Smart Chain", "Arbitrum One", "Polygon", "Optimism", "Avalanche C-Chain", "Blast"];

test("the logo row and text link name each public selectable chain once", () => {
  const html = markup();
  const images = [...html.matchAll(/<img\b[^>]*>/g)].map(([image]) => image);
  const networks = security.NETWORKS.filter((network) => network !== "auto" && network !== "robinhood");
  assert.equal(images.length, 9);
  assert.equal(images.length, networks.length);
  assert.match(html, /<p>Supported networks<\/p>/);
  assert.match(html, /<ul class="network-logo-row" aria-label="Supported blockchain networks">/);
  assert.deepEqual(images.map((image) => image.match(/alt="([^"]+)"/)[1]), names);
  assert.deepEqual(images.map((image) => image.match(/src="([^"]+)"/)[1]), networks.map((network) => `/networks/${network}.svg`));
  assert.deepEqual([...html.matchAll(/<li title="([^"]+)">/g)].map((match) => match[1]), names);
  assert.doesNotMatch(html, /Auto detect/i);
  assert.match(html, /class="network-text-row"/);
  assert.match(html, />Robinhood Chain<\/a>/);
  assert.equal((html.match(/official website \(opens in a new tab\)/g) || []).length, security.NETWORKS.length - 1);
});

test("the linked local logo row adds no remote asset requests, animation, or network selection actions", () => {
  const html = markup();
  for (const [image] of html.matchAll(/<img\b[^>]*>/g)) {
    assert.match(image, /src="\/networks\/[a-z]+\.svg"/);
    assert.match(image, /width="30" height="30"/);
  }
  assert.doesNotMatch(html, /<(?:button|input|select|form|iframe|script)\b/);
  assert.doesNotMatch(source("../components/supported-networks.tsx"), /\b(?:fetch|setInterval|setTimeout|requestAnimationFrame|useEffect)\s*\(|onClick|onChange|animation/);
});

test("all supported networks link to their official websites in safe, labelled new tabs", () => {
  const html = markup();
  const links = [...html.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)].map(([link]) => link);
  const destinations = ["https://solana.com/", "https://ethereum.org/", "https://www.base.org/", "https://www.bnbchain.org/en/bnb-smart-chain", "https://arbitrum.io/", "https://polygon.technology/", "https://optimism.io/", "https://www.avalanche.com/", "https://blast.io/", "https://docs.robinhood.com/chain/"];
  const allNames = [...names, "Robinhood Chain"];
  assert.equal(links.length, allNames.length);
  assert.deepEqual(links.map(link => link.match(/href="([^"]+)"/)[1]), destinations);
  for (let i = 0; i < links.length; i++) {
    assert.match(links[i], /rel="noopener noreferrer"/);
    assert.ok(links[i].includes(`aria-label="${allNames[i]} official website (opens in a new tab)"`));
    const url = new URL(destinations[i]);
    assert.equal(url.protocol, "https:");
    assert.equal(url.search, "");
  }
  assert.match(html, /href="\/terms#third-party-marks">Independent service · No affiliation<\/a>/);
});

test("all nine local SVGs are passive, licensed assets and the row follows the search form", () => {
  const networks = security.NETWORKS.filter(network => network !== "auto" && network !== "robinhood");
  for (const network of networks) {
    const svg = source(`../public/networks/${network}.svg`);
    assert.match(svg, /^<svg\s/);
    assert.match(svg, /viewBox="0 0 24 24"/);
    assert.doesNotMatch(svg, /<(?:script|foreignObject|image|a)\b|\bon\w+\s*=|(?:xlink:)?href\s*=|<!DOCTYPE|<!ENTITY/i);
  }
  assert.match(source("../public/networks/LICENCE.txt"), /MIT License/);
  assert.match(source("../app/research-desk.tsx"), /<\/form>\s*<SupportedNetworks\/>/);
  assert.match(source("../app/globals.css"), /grid-template-columns: repeat\(9, minmax\(0, 1fr\)\)/);
});
