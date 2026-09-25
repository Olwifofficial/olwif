import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import ts from "typescript";
import {reportTrafficLight} from "../lib/research/traffic-light.js";
import {findReportSection,reportSectionUrl} from "../lib/research/report-sections.js";

const complete = () => ({
 tier: "YELLOW", hardFailCount: 0,
 findings: [{severity:"good",title:"A listed check passed"}],
 sources: [{name:"Solana mint",ok:true},{name:"RugCheck",ok:true}],
 research: {
  classification:"No critical warning found — not a safety guarantee", mainConcern:"Review the dated evidence.",
  concerns:[], unknowns:[],
  assessments:[
   {name:"Identity",status:"Verified on-chain"}, {name:"Integrity",status:"Checks passed"},
   {name:"Substance",status:"Verified"}, {name:"Flow quality",status:"Reviewed"},
   {name:"Momentum",status:"Negative"},
  ],
 },
});

test("green requires clear listed evidence, and does not promise safety", () => {
 const light = reportTrafficLight(complete());
 assert.equal(light.color,"green");
 assert.match(light.reason,/not a safety guarantee/);
});

test("serious evidence wins over good findings, missing data, low scores, or positive momentum", () => {
 for (const patch of [{hardFailCount:1},{tier:"RED"},{tier:"REJECT"},{findings:[{severity:"danger"}]},{findings:[{severity:"good",hardFail:true}]}]) {
  assert.equal(reportTrafficLight({...complete(),...patch,confidence:100,riskScore:0,momentum:{score:100}}).color,"red");
 }
});

test("ordinary warnings are amber, not automatically allegations of fraud", () => {
 for (const patch of [{tier:"AMBER"},{findings:[{severity:"warn"}]}]) assert.equal(reportTrafficLight({...complete(),...patch}).color,"amber");
 const r=complete();r.research.concerns.push("Review a reported issue");
 assert.equal(reportTrafficLight(r).color,"amber");
});

test("missing and unknown evidence never falls through to green", () => {
 const cases = [
  {}, {findings:[],sources:[]},
  {...complete(),sources:[]}, {...complete(),findings:[]}, {...complete(),tier:"UNKNOWN"},
  {...complete(),sources:[{name:"Solana mint",ok:true},{name:"RugCheck",ok:false}]},
  {...complete(),sources:[{name:"DEX market",ok:true}]},
  {...complete(),findings:[{severity:"unknown"}]},
  {...complete(),findings:[{severity:"unexpected"}]},
  {...complete(),findings:[null]},
 ];
 for (const report of cases) assert.equal(reportTrafficLight(report).color,"amber");
 for (const key of ["unknowns","concerns","assessments"]) {
  const r=complete();delete r.research[key];
  assert.equal(reportTrafficLight(r).color,"amber",key);
 }
});

test("the existing Wrapped SOL-style report remains amber despite no critical warning", () => {
 const r=complete();r.research.unknowns=["A complete audit has not been performed."];
 assert.equal(reportTrafficLight(r).color,"amber");
 for (const status of ["Partial checks passed","Needs independent review","Not established","Not verified","Pending review","Unconfirmed","Research required","A brand-new status"]) {
  const r=complete();r.research.assessments[1].status=status;
  assert.equal(reportTrafficLight(r).color,"amber",status);
 }
});

test("traffic light never uses token price, momentum, or confidence as a safety proxy", () => {
 for (const score of [0,50,100]) {
  assert.equal(reportTrafficLight({...complete(),momentum:{score},confidence:score,riskScore:score}).color,"green");
  assert.equal(reportTrafficLight({momentum:{score},confidence:score,riskScore:score}).color,"amber");
 }
});

const require=createRequire(import.meta.url);
const source=readFileSync(new URL("../components/report-verdict.tsx",import.meta.url),"utf8");
const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}});
const module={exports:{}};
new Function("require","module","exports",outputText)(name=>name==="@/lib/research/traffic-light.js"?{reportTrafficLight}:name==="@/lib/research/report-sections.js"?{findReportSection,reportSectionUrl}:require(name),module,module.exports);
const ReportVerdict=module.exports.default;

test("all three states render a matching box, teacher-owl sign, and a visible non-colour-only label", () => {
 for (const [color,r] of [["green",complete()],["amber",{}],["red",{hardFailCount:1}]]) {
  const html=renderToStaticMarkup(React.createElement(ReportVerdict,{report:r}));
  assert.match(html,new RegExp(`class="verdict verdict--${color}"`));
  const sign={green:["checked","CHECKED"],amber:["pause","PAUSE"],red:["stop","STOP"]}[color];
  assert.match(html,new RegExp(`src="/o-owl-${sign[0]}\\.png"`));
  assert.match(html,new RegExp(`alt="O holding a ${sign[1]} sign:`));
  assert.equal((html.match(/<img\b/g)||[]).length,1);
  assert.match(html,new RegExp(`aria-label="Research summary: ${color === "amber" ? "YELLOW" : color.toUpperCase()}`));
  assert.match(html,/<div class="verdict-mascot">/);
  assert.match(html,/<details class="verdict-key"><summary>What the colours mean<\/summary>/);
  assert.match(html,/Not an endorsement, investment recommendation or guarantee\./);
  assert.doesNotMatch(html,/against a rug pull/);
  assert.doesNotMatch(html,/HelpCircle|verdict-icon/);
  assert.match(html,/Not an instruction to buy or a guarantee/);
 }
});

test("classification and concern remain escaped text and the component does not mutate saved reports", () => {
 const r=complete();r.research.mainConcern='<img src=x onerror="alert(1)">';
 const before=JSON.stringify(r);
 const html=renderToStaticMarkup(React.createElement(ReportVerdict,{report:r}));
 assert.ok(html.includes('&lt;img'));
 assert.equal(html.includes('<img src=x'),false);
 assert.equal(JSON.stringify(r),before);
});

test("compact overall summary is one accessible link and keeps serious warnings prominent",()=>{
 const report=complete();report.findings.push({severity:"danger",title:"Insider warning",category:"Distribution"});
 const before=structuredClone(report);
 const html=renderToStaticMarkup(React.createElement(ReportVerdict,{report,reportId:"saved-report"}));
 assert.match(html,/<a class="verdict verdict--red verdict-link" href="\/report\/saved-report\/summary"/);
 assert.match(html,/<h2>1 serious warning<\/h2>/);
 assert.match(html,/View findings/);
 assert.equal((html.match(/<a\b/g)||[]).length,1);
 assert.doesNotMatch(html,/<details|<button|verdict-explanation|Review the dated evidence/);
 assert.match(html,/not a safety guarantee/);
 assert.match(html,/alt="O holding a STOP sign:/);
 assert.deepEqual(report,before);
});

test("compact summary keeps the same light for all evidence states and rejects unsafe routes",()=>{
 for(const [report,color] of [[complete(),"green"],[{},"amber"],[{hardFailCount:1},"red"]]) {
  const html=renderToStaticMarkup(React.createElement(ReportVerdict,{report,reportId:"saved-report"}));
  assert.match(html,new RegExp(`verdict--${color} verdict-link`));
  assert.match(html,new RegExp(`src="/o-owl-${{green:"checked",amber:"pause",red:"stop"}[color]}\\.png"`));
 }
 for(const id of ["../other","a?b=1","javascript:alert(1)",""]) {
  const html=renderToStaticMarkup(React.createElement(ReportVerdict,{report:complete(),reportId:id}));
  assert.doesNotMatch(html,/verdict-link|<a\b/);
 }
});

test("all teacher-owl signs are bundled transparent PNGs, with the original mascot preserved",()=>{
 const images=["stop","pause","checked"].map(sign=>readFileSync(new URL(`../public/o-owl-${sign}.png`,import.meta.url)));
 for(const image of images) {
  assert.equal(image.subarray(1,4).toString(),"PNG");
  assert.equal(image[25],6,"RGBA artwork retains its transparent background");
  assert.ok(image.readUInt32BE(16)>=440,"Artwork supports high-density displays");
 }
 assert.ok(!images[0].equals(images[1])&&!images[1].equals(images[2]));
 assert.ok(readFileSync(new URL("../public/o-owl.png",import.meta.url)).length>0);
});
