import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../app/terms/page.tsx", import.meta.url), "utf8");
const {outputText} = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}});
const module = {exports:{}};
new Function("require", "module", "exports", outputText)(name => name === "@/app/site-shell" ? {__esModule:true,default:({children}) => React.createElement("div", null, children)} : require(name), module, module.exports);
const render = () => renderToStaticMarkup(React.createElement(module.exports.default));

test("terms disclose enabled provider families and link to their origins", () => {
 const html = render();
 assert.match(html, /<section id="research-providers">/);
 for (const name of ["DEX Screener", "GeckoTerminal", "CoinGecko", "RugCheck", "GoPlus Security", "Blockscout", "PublicNode", "Solana Tracker", "GitHub", "Tavily", "Jina Reader"]) assert.ok(html.includes(name), `${name} must be disclosed`);
 for (const url of ["https://dexscreener.com/", "https://www.geckoterminal.com/", "https://rugcheck.xyz/", "https://gopluslabs.io/", "https://www.blockscout.com/", "https://www.publicnode.com/", "https://www.solanatracker.io/", "https://solana.com/docs/references/clusters", "https://github.com/", "https://www.tavily.com/", "https://jina.ai/reader/"]) assert.ok(html.includes(`href="${url}" target="_blank" rel="noopener noreferrer"`), `${url} must open safely`);
 assert.match(html, /not a promise that every provider was used/);
 assert.match(html, /Collection times and evidence gaps remain part of each report/);
});

test("provider disclosure preserves independence, source rights and legal-review caveats", () => {
 const html = render();
 assert.match(html, /providers do not endorse OLWIF or approve its ratings/);
 assert.match(html, /CoinGecko API and its associated intellectual property belong to CoinGecko/);
 assert.match(html, /not a substitute for required on-page credit, a licence or any necessary permission/);
 assert.match(html, /does not grant visitors rights to republish or resell third-party data/);
 assert.match(html, /permitted storage and public redistribution need review before public launch/);
 assert.match(html, /href="\/privacy"/);
 assert.match(html, /BETA TERMS · DRAFT/);
 assert.doesNotMatch(html, /all providers have approved|fully legally protected|unlimited access|guaranteed complete coverage/i);
});
