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

test("logo notice explains non-affiliation and ownership without inventing legal permission", () => {
 const html = render();
 assert.match(html, /<section id="third-party-marks">/);
 assert.match(html, /not affiliated with, sponsored by, endorsed by, or acting on behalf/);
 assert.match(html, /property of their respective rights holders/);
 assert.match(html, /does not claim a partnership, endorsement agreement or special permission/);
 assert.match(html, /not, by itself, evidence of a trademark licence/);
 assert.match(html, /does not grant OLWIF or visitors permission/);
 assert.match(html, /Any required permissions and compliance with applicable law remain necessary/);
});

test("draft terms retain public-launch review, consumer rights and independent external-site responsibilities", () => {
 const html = render();
 assert.match(html, /BETA TERMS · DRAFT/);
 assert.match(html, /operator’s legal identity, contact details/);
 assert.match(html, /final public terms need professional review/);
 assert.match(html, /Nothing in these draft terms is intended to exclude rights or liability that cannot lawfully be excluded/);
 assert.match(html, /open external network websites in a new tab/);
 assert.match(html, /subject to their own terms and privacy policies/);
 assert.match(html, /not a recommendation to buy an asset, connect a wallet, transfer funds/);
 assert.doesNotMatch(html, /legally protected|no legal liability|all liability is excluded|permission is not required/i);
});
