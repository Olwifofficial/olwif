import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
function load(path, stubs = {}) {
 const source = readFileSync(new URL(path, import.meta.url), "utf8");
 const {outputText} = ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}});
 const module = {exports:{}};
 new Function("require", "module", "exports", outputText)(name => Object.hasOwn(stubs, name) ? stubs[name] : require(name), module, module.exports);
 return module.exports;
}
const security = load("../lib/security.ts");
const PublicWebResearch = load("../components/public-web-research.tsx", {"@/lib/security":security}).default;
const render = report => renderToStaticMarkup(React.createElement(PublicWebResearch, {report}));
const fixture = () => ({riskScore:32, research:{webResearch:{
 version:1, mode:"free-only", checkedAt:"2026-09-24T11:00:00Z", status:"partial",
 search:{status:"not_configured",provider:"Tavily",message:"API key missing",checkedAt:"2026-09-24T11:00:00Z"},
 pages:[{id:"page-1",url:"https://project.example/docs",title:"Project documentation",kind:"docs",discoveredVia:"Token metadata",association:"reported-link",addressMentioned:false,checkedAt:"2026-09-24T11:00:01Z",publishedAt:null,observations:["A repository link is present in the returned page text."],excerpt:"Our project builds a useful product."}],
 summary:["One public page returned readable text."],limitations:["Only a small selection of reported links was checked."],
 checks:[{name:"Public page",url:"https://project.example/docs",provider:"Jina Reader",ok:true,checkedAt:"2026-09-24T11:00:01Z",message:"Returned"}]
}}});

test("older saved reports clearly need a fresh public-page check", () => {
 const html = render({});
 assert.match(html, /This saved report predates public-page checks\. Refresh check to include them\./);
 assert.doesNotMatch(html, /No page content collected|Free-only|guaranteed|safe token/i);
});

test("public-page findings keep evidence links and limits without search handoffs or provider narration", () => {
 const report = fixture(), before = JSON.stringify(report), html = render(report);
 assert.doesNotMatch(html, /Free-only|No paid fallback|free account|API key/i);
 assert.match(html, /Partial coverage/);
 assert.match(html, /One public page returned readable text/);
 assert.match(html, /Wider web search was not available/);
 assert.match(html, /ownership is not independently verified/);
 assert.match(html, /Page excerpt, not a verified claim/);
 assert.match(html, /Publication date: Not supplied/);
 assert.match(html, /href="https:\/\/project\.example\/docs" target="_blank" rel="noopener noreferrer"/);
 assert.match(html, /View page/);
 assert.match(html, /These checks do not verify team identities, social activity, project promises or safety/);
 assert.doesNotMatch(html, /Tavily|Jina|Google|Brave|Keep following the trail|search\.brave|google\.com\/search|AI analysis|risk score|safety score/i);
 assert.equal(JSON.stringify(report), before, "Rendering must not mutate evidence or scores");
});

test("untrusted page text is escaped and unsafe source links are not clickable", () => {
 const report = fixture(), data = report.research.webResearch;
 const attack = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
 data.pages[0] = {...data.pages[0],title:attack,url:"javascript:alert(1)",observations:[attack],excerpt:attack};
 data.summary = [attack]; data.limitations = [attack];
 const html = render(report);
 assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
 assert.match(html, /&lt;script&gt;alert\(2\)&lt;\/script&gt;/);
 assert.doesNotMatch(html, /<script|<img|href="javascript:|href="data:/);
 assert.match(html, /Page link not available/);
});

test("empty and malformed values remain unknown rather than positive findings", () => {
 const report = fixture(), data = report.research.webResearch;
 data.pages = []; data.summary = []; data.limitations = []; data.checkedAt = null; data.search.status = "error";
 let html = render(report);
 assert.match(html, /Checked: Not supplied · No page content collected/);
 assert.match(html, /Web search did not return usable results/);
 assert.match(html, /a gap in the evidence, not a positive or negative verdict/);
 assert.doesNotMatch(html, /1970|Complete coverage|Search complete|No concerns|No risk/);
 data.pages = [null, 42, "not a page", {title:"Unknown page",observations:{bad:true},publishedAt:"invalid",checkedAt:"invalid"}];
 html = render(report);
 assert.match(html, /Association with this exact token is not confirmed/);
 assert.match(html, /Page checked: Not supplied · Publication date: Not supplied/);
});

test("matching an exact token address is not presented as authenticated ownership", () => {
 const report = fixture(), data = report.research.webResearch;
 data.pages[0].association = "exact-address"; data.pages[0].addressMentioned = true;
 data.pages[0].excerpt = "A".repeat(401);
 data.search.status = "available";
 const html = render(report);
 assert.match(html, /exact token address appears in the returned text/);
 assert.match(html, /does not prove ownership or authenticity/);
 assert.match(html, /limited web search returned results/);
 assert.match(html, /A{400}…/);
 assert.doesNotMatch(html, /A{401}/);
});

test("a blocked search remains an honest gap without exposing budget mechanics", () => {
 const report = fixture();
 report.research.webResearch.search.status = "limited";
 const html = render(report);
 assert.match(html, /Web search could not be completed/);
 assert.doesNotMatch(html, /free-only|free-use|paid fallback/i);
});

test("older timeout notes hide operational wording without changing saved evidence", () => {
 const report = fixture();
 report.research.webResearch.limitations = ["No conclusions about page content or social activity were made. No paid fallback was used."];
 const original = JSON.stringify(report), html = render(report);
 assert.match(html, /No conclusions about page content or social activity were made\./);
 assert.doesNotMatch(html, /paid fallback|free-only/i);
 assert.equal(JSON.stringify(report), original);
});
