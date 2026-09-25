import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import ts from "typescript";
import {reportSectionUrl} from "../lib/research/report-sections.js";

const require=createRequire(import.meta.url);
const source=path=>readFileSync(new URL(path,import.meta.url),"utf8");
const {outputText}=ts.transpileModule(source("../components/pros-cons.tsx"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}});
const module={exports:{}};
const imports={"@/lib/research/pros-cons.js":{reportProsCons:report=>report.compact},"@/lib/research/report-sections.js":{reportSectionUrl}};
new Function("require","module","exports",outputText)(name=>Object.hasOwn(imports,name)?imports[name]:require(name),module,module.exports);
const ProsCons=module.exports.default;
const REPORT_ID="22a01be6-ed6f-4fe6-b500-329790767e95";
const entry=(text,severity="good",hardFail=false)=>({text,severity,hardFail});
const fixture=()=>({generatedAt:"2026-09-24T12:00:00Z",findings:[{code:"RAW",detail:"Original dated evidence must remain untouched."}],research:{whyItMightRun:"Long speculative price prose does not belong in the compact overview.",strengths:["A long legacy strength paragraph."],concerns:["A long legacy concern paragraph."]},compact:{pros:[entry("Mint authority revoked."),entry("Freeze authority revoked.")],cons:[entry("Possible insider links flagged — not independently verified.","danger")]}});
const render=(report=fixture(),props={})=>renderToStaticMarkup(React.createElement(ProsCons,{report,reportId:REPORT_ID,...props}));
const visible=html=>html.replace(/<[^>]*>/g,"");

test("Pros and Cons contain short readable bullets instead of repeating the legacy narrative",()=>{
 const report=fixture(),before=JSON.stringify(report),html=render(report);
 assert.match(html,/<h2[^>]*>(?:<span[^>]*>\+<\/span>)?Pros<\/h2>/);
 assert.match(html,/<h2[^>]*>(?:<span[^>]*>−<\/span>)?Cons<\/h2>/);
 for(const item of [...report.compact.pros,...report.compact.cons])assert.ok(html.includes(item.text));
 assert.equal((html.match(/<li\b/g)||[]).length,3);
 assert.doesNotMatch(html,/What supports the case|What should give you pause|Why it might still run|Long speculative price prose|long legacy/i);
 assert.equal(JSON.stringify(report),before,"Compact rendering must preserve the saved report and original evidence");
});

test("ordinary summaries are limited to four bullets per side and link to all findings",()=>{
 const report=fixture();
 report.compact.pros=Array.from({length:7},(_,index)=>entry(`Positive finding ${index+1}.`));
 report.compact.cons=Array.from({length:6},(_,index)=>entry(`Ordinary concern ${index+1}.`,"warn"));
 const html=render(report);
 assert.equal((html.match(/<li\b/g)||[]).length,8);
 for(const text of ["Positive finding 1.","Positive finding 4.","Ordinary concern 1.","Ordinary concern 4."])assert.ok(html.includes(text));
 for(const text of ["Positive finding 5.","Ordinary concern 5."])assert.ok(!html.includes(text));
 assert.match(html,/href="\/report\/22a01be6-ed6f-4fe6-b500-329790767e95\/summary#all-findings"/);
 assert.match(visible(html),/3\s+(?:more|additional)/i);
 assert.match(visible(html),/2\s+(?:more|additional)/i);
});

test("serious warnings and hard failures are never omitted to enforce a visual bullet limit",()=>{
 const report=fixture();report.compact.pros=[];
 report.compact.cons=[entry("Ordinary concern at the start.","warn"),...Array.from({length:5},(_,index)=>entry(`Serious concern ${index+1}.`,"danger")),entry("Hard failure with warning severity.","warn",true),entry("Ordinary concern at the end.","warn")];
 const before=JSON.stringify(report),html=render(report);
 for(const item of report.compact.cons.filter(item=>item.severity==="danger"||item.hardFail))assert.ok(html.includes(item.text),`Serious warning omitted: ${item.text}`);
 assert.equal((html.match(/<li\b/g)||[]).length,6,"Only non-serious items may be folded away when six serious warnings exist");
 assert.equal(JSON.stringify(report),before);
});

test("a detailed summary uses an in-page findings link instead of loading itself again",()=>{
 const html=render(fixture(),{detailed:true});
 assert.match(html,/href="#finding-details"/);
 assert.doesNotMatch(html,/href="\/report\//);
});

test("detailed Pros and Cons show every compact point instead of applying the overview limit",()=>{
 const report=fixture();
 report.compact.pros=Array.from({length:7},(_,index)=>entry(`Full positive point ${index+1}.`));
 report.compact.cons=Array.from({length:6},(_,index)=>entry(`Full ordinary concern ${index+1}.`,"warn"));
 const before=JSON.stringify(report),html=render(report,{detailed:true});
 for(const item of [...report.compact.pros,...report.compact.cons])assert.ok(html.includes(item.text),`Detailed evidence omitted: ${item.text}`);
 assert.equal((html.match(/<li\b/g)||[]).length,13);
 assert.doesNotMatch(html,/\d+ more in the full findings/);
 assert.equal(JSON.stringify(report),before);
});

test("unsafe or missing report IDs cannot create arbitrary navigation links",()=>{
 for(const reportId of [undefined,"","../outside",'\"><script>alert(1)</script>',"https://evil.example/"]){
  const html=render(fixture(),{reportId});
  assert.doesNotMatch(html,/href="(?:https:|javascript:|data:|\/report\/\.\.)|<script>|onclick=/i);
  for(const [,href] of html.matchAll(/href="([^"]+)"/g))assert.ok(href==="#all-findings"||href.startsWith("/report/"));
 }
});

test("untrusted compact text is escaped and empty evidence is not presented as all clear",()=>{
 const report=fixture();report.compact.pros=[entry('<img src=x onerror="alert(1)">')];report.compact.cons=[entry('<script>alert(2)</script>',"danger")];
 const html=render(report);
 assert.match(html,/&lt;img/);assert.match(html,/&lt;script/);
 assert.doesNotMatch(html,/<script>|<img|<[^>]+ onerror=/);
 report.compact={pros:[],cons:[]};
 const empty=render(report);
 assert.match(empty,/<h2[^>]*>(?:<span[^>]*>\+<\/span>)?Pros<\/h2>/);assert.match(empty,/<h2[^>]*>(?:<span[^>]*>−<\/span>)?Cons<\/h2>/);
 assert.doesNotMatch(visible(empty),/all clear|no risks|risk.free|safe to buy/i);
 assert.match(visible(empty),/not|limited|recorded|returned|established|available/i);
});

test("compactness comes from selected content, not inaccessible CSS clipping of paragraphs",()=>{
 const report=fixture(),html=render(report);
 for(const match of html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g))assert.ok(visible(match[1]).length<=180,"Overview bullets should be brief");
 assert.doesNotMatch(html,/line-clamp|text-overflow|overflow:\s*hidden|\shidden=|aria-hidden="true"[^>]*>[^<]*Possible insider/i);
 assert.doesNotMatch(source("../components/pros-cons.tsx"),/line-clamp|textOverflow|overflow:\s*["']hidden|\.slice\(0,\s*\d+\).*\.\.\./);
});
