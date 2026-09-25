import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import ts from "typescript";
import {assessmentTrafficLight,reportTrafficLight} from "../lib/research/traffic-light.js";
import {projectEvidence} from "../lib/research/project-evidence.js";
import {tradingActivity} from "../lib/research/assessment-details.js";
import * as marketSnapshotModule from "../lib/research/market-snapshot.js";
import {findReportSection,sectionForAssessment,reportSectionUrl} from "../lib/research/report-sections.js";

const source = path => readFileSync(new URL(path,import.meta.url),"utf8");
const assessment = (name,status) => ({name,status,summary:"Evidence from this dated check."});
const fixture = () => ({
 momentum:{score:62},
 sources:[{name:"Solana mint",ok:true},{name:"RugCheck",ok:true},{name:"DEX market",ok:true}],
 findings:[{severity:"good",category:"Authority",code:"MINT_AUTHORITY_REVOKED"}],
 research:{unknowns:["Some due diligence is incomplete"],concerns:[],assessments:[
  assessment("Identity","Verified on-chain"), assessment("Integrity","Partial checks passed"),
  assessment("Substance","Needs independent review"), assessment("Momentum","Positive"),
  assessment("Flow quality","Not established"),
 ]},
});

test("each current report card gets its own meaningful light without changing the overall verdict", () => {
 const report=fixture();
 const before=JSON.stringify(report);
 assert.deepEqual(report.research.assessments.map(a=>assessmentTrafficLight(a,report).color),["green","amber","amber","green","amber"]);
 assert.equal(reportTrafficLight(report).color,"amber");
 assert.equal(JSON.stringify(report),before);
});

test("identity green needs a successful exact-address source and no contradictory identity finding", () => {
 const a=assessment("Identity","Verified on-chain");
 assert.equal(assessmentTrafficLight(a,{}).color,"amber");
 assert.equal(assessmentTrafficLight(assessment("Identity","Exact address indexed"),fixture()).color,"amber");
 const r=fixture();r.findings.push({severity:"danger",category:"Contract"});
 assert.equal(assessmentTrafficLight(a,r).color,"green","An unrelated contract risk is not an identity failure");
 r.findings.push({severity:"danger",category:"Identity"});
 assert.equal(assessmentTrafficLight(a,r).color,"red");
});

test("integrity and flow flags override optimistic labels, with warnings distinct from serious findings", () => {
 for (const [severity,color] of [["warn","amber"],["unknown","amber"],["danger","red"]]) {
  const r=fixture();r.findings.push({category:"Distribution",code:"INSIDER_GRAPH",severity});
  for (const a of [assessment("Integrity","Checks passed"),assessment("Flow quality","Reviewed")]) assert.equal(assessmentTrafficLight(a,r).color,color);
 }
 const r=fixture();r.findings.push({category:"Authority",hardFail:true,severity:"warn"});
 assert.equal(assessmentTrafficLight(assessment("Integrity","Partial checks passed"),r).color,"red");
});

test("unknown, partial, unrecognised or unsupported affirmative statuses stay yellow", () => {
 for (const name of ["Identity","Integrity","Substance","Momentum","Flow quality","Unexpected card"]) {
  for (const status of ["Unknown","Pending review","Partial checks passed","A future status",""]) assert.equal(assessmentTrafficLight(assessment(name,status),fixture()).color,"amber");
 }
 assert.equal(assessmentTrafficLight(assessment("Integrity","Checks passed"),{findings:[{category:"Authority",severity:"good"}]}).color,"amber");
 assert.equal(assessmentTrafficLight(assessment("Substance","Verified"),fixture()).color,"amber");
});

test("momentum needs a valid market snapshot and never silently turns missing observations green", () => {
 for (const [status,score,color] of [["Strong",80,"green"],["Positive",62,"green"],["Mixed",48,"amber"],["Weak",25,"red"],["Positive",10,"amber"],["Unknown",null,"amber"]]) {
  const r=fixture();r.momentum.score=score;
  assert.equal(assessmentTrafficLight(assessment("Momentum",status),r).color,color);
 }
 for (const score of [null,undefined,NaN,Infinity,-1,101,"80"]) {
  const r=fixture();r.momentum.score=score;
  assert.equal(assessmentTrafficLight(assessment("Momentum","Strong"),r).color,"amber");
 }
 const r=fixture();r.sources=[];
 assert.equal(assessmentTrafficLight(assessment("Momentum","Positive"),r).color,"amber");
 const conflict=fixture();conflict.findings.push({category:"Market",severity:"warn",code:"MARKET_SOURCE_DISAGREEMENT"});
 assert.equal(assessmentTrafficLight(assessment("Momentum","Positive"),conflict).color,"amber");
});

const require=createRequire(import.meta.url);
const {outputText}=ts.transpileModule(source("../components/assessment-card.tsx"),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}});
const module={exports:{}};
const imports={"@/lib/research/traffic-light.js":{assessmentTrafficLight},"@/lib/research/project-evidence.js":{projectEvidence},"@/lib/research/assessment-details.js":{tradingActivity},"@/lib/research/market-snapshot.js":marketSnapshotModule,"@/lib/research/report-sections.js":{findReportSection,sectionForAssessment,reportSectionUrl}};
new Function("require","module","exports",outputText)(name=>imports[name]||require(name),module,module.exports);
const AssessmentCard=module.exports.default;
const REPORT_ID="0bdb7066-211c-452e-8f45-38e3b5d47dab";
const render=(name,report=fixture(),reportId=REPORT_ID)=>renderToStaticMarkup(React.createElement(AssessmentCard,{assessment:report.research.assessments.find(a=>a.name===name),report,reportId}));

test("cards render proper titles, readable statuses and only one active decorative lamp", () => {
 for (const a of fixture().research.assessments) {
  const html=renderToStaticMarkup(React.createElement(AssessmentCard,{assessment:a,report:fixture()}));
  const title=findReportSection(sectionForAssessment(a.name)).title.replaceAll("&","&amp;");
  assert.match(html,new RegExp(`<h3>${title}</h3>`));
  if(!["Momentum","Flow quality"].includes(a.name)) assert.match(html,/<strong class="assessment-status">/);
  assert.match(html,/<span class="assessment-colour">(?:GREEN|YELLOW|RED)<\/span>/);
  assert.equal((html.match(/ is-active/g)||[]).length,1);
  assert.match(html,/<div class="assessment-lights" aria-hidden="true">/);
  if(a.name==="Momentum") assert.match(html,/Saved snapshot · market direction, not a forecast/);
 }
 const malicious=assessment("Identity","<script>alert(1)</script>");
 const html=renderToStaticMarkup(React.createElement(AssessmentCard,{assessment:malicious,report:fixture()}));
 assert.ok(html.includes("&lt;script&gt;"));assert.ok(!html.includes("<script>"));
});

test("yellow border and active lamp share the same hue, with a paler fill and larger card titles", () => {
 const css=source("../app/verdict.css");
 assert.match(css,/\.verdict--amber, \.assessment--amber \{ --signal: #e6c229; --signal-tint: #fffce8;/);
 assert.match(css,/\.traffic-lamp--amber\.is-active \{ background: #e6c229;/);
 assert.match(css,/\.assessment\[class\*="assessment--"\] \{\s*border: 2px solid var\(--signal\);\s*background: var\(--signal-tint\)/);
 assert.match(css,/\.assessment \.assessment-heading h3 \{ font: 700 26px/);
 assert.match(css,/\.assessment-status \{ font: 600 21px/);
 assert.doesNotMatch(css,/#a96a12|#805013/);
});

test("every compact card is one normal accessible link to its dedicated findings page",()=>{
 const report=fixture(),sections={Identity:"identity",Integrity:"integrity",Substance:"project",Momentum:"momentum","Flow quality":"activity"};
 for(const [name,section] of Object.entries(sections)) {
  const html=render(name,report);
  assert.match(html,new RegExp(`^<a[^>]*class="assessment assessment--[a-z]+ assessment-link"[^>]*href="/report/${REPORT_ID}/${section}"`));
  assert.equal((html.match(/<a\b/g)||[]).length,1);
  if(!["Momentum","Flow quality"].includes(name)) assert.equal((html.match(/<p\b/g)||[]).length,1,"Generic cards have one brief preview, not a report inside the card");
  assert.match(html,/aria-label="[^"]+ (?:GREEN|YELLOW|RED)\. View findings\."/);
  assert.match(html,/class="assessment-action">View findings <span aria-hidden="true">→<\/span>/);
  assert.doesNotMatch(html,/<button|<details|<summary|role="button"|onclick=|tabindex=/i);
  if(!["Momentum","Flow quality"].includes(name)) assert.doesNotMatch(html,/<ul|<dl/i);
  assert.doesNotMatch(html,/Evidence from this dated check/,"Long saved summaries belong on detail pages");
 }
 assert.doesNotMatch(source("../components/assessment-card.tsx"),/onClick=|window\.location/);
});

test("project card counts usable links without placing nested project links or unsafe text inside it",()=>{
 const report=fixture();
 report.research.links=[{kind:"website",url:"https://project.example/",label:"Our website"},{kind:"social",url:"https://x.com/ExampleToken",label:"X"},{kind:"docs",url:"https://docs.project.example/",label:"Docs"},{kind:"github",url:"https://github.com/example/project"},{kind:"social",url:"javascript:alert(1)",label:"Unsafe"},{kind:"social",url:"https://user:secret@evil.example/",label:"Unsafe credentials"}];
 report.research.webResearch={pages:[{url:"https://project.example/",association:"reported-link",extractedLinks:[{kind:"social",url:"https://t.me/example_token"}]},{url:"https://unrelated.example/",association:"unknown",extractedLinks:[{kind:"social",url:"https://x.com/UnrelatedToken"}]}]};
 const before=JSON.stringify(report),html=render("Substance",report);
 assert.match(html,/<h3>People &amp; project<\/h3>/);
 assert.match(html,/5 project links found/);
 assert.match(html,/2 public pages read · ownership not verified/);
 assert.match(html,/assessment--amber/);
 assert.doesNotMatch(html,/href="https:|javascript:|user:secret|UnrelatedToken|<details|<ul/);
 assert.equal(JSON.stringify(report),before);
 report.research.links=[];delete report.research.webResearch;
 assert.match(render("Substance",report),/No project links found/);
 assert.match(render("Substance",report),/Page content not checked/);
});

const classContents=(html,className)=>html.match(new RegExp(`<([a-z0-9]+)[^>]*class="[^"]*\\b${className}\\b[^"]*"[^>]*>([\\s\\S]*?)<\\/\\1>`))?.[2]||"";
const counts=(html)=>classContents(html,"assessment-counts");

test("activity puts prominent buy and sell counts in the shortest complete returned window and preserves zero",()=>{
 const report=fixture();
 report.research.market={windows:[{window:"24h",buys:100,sells:50,volumeUsd:1234},{window:"1h",buys:12,sells:7,volumeUsd:200},{window:"5m",buys:0,sells:0,volumeUsd:0}]};
 const before=JSON.stringify(report),html=render("Flow quality",report);
 assert.match(html,/<h3>Buying &amp; selling<\/h3>/);
 assert.match(classContents(html,"assessment-window"),/5m activity snapshot/);
 assert.match(counts(html),/<dt[^>]*>Buys<\/dt>\s*<dd[^>]*>0<\/dd>/);
 assert.match(counts(html),/<dt[^>]*>Sells<\/dt>\s*<dd[^>]*>0<\/dd>/);
 assert.equal((counts(html).match(/<dd\b/g)||[]).length,2);
 assert.match(html,/assessment--amber/);
 assert.equal(tradingActivity(report).selected.volumeUsd,0,"Zero volume remains intact for the detail page");
 assert.equal(JSON.stringify(report),before);
 report.research.market.windows[2].sells=null;
 const longer=render("Flow quality",report);
 assert.match(classContents(longer,"assessment-window"),/1h activity snapshot/);
 assert.match(counts(longer),/<dt[^>]*>Buys<\/dt>\s*<dd[^>]*>12<\/dd>/);
 assert.match(counts(longer),/<dt[^>]*>Sells<\/dt>\s*<dd[^>]*>7<\/dd>/);
});

test("partial and missing activity remain distinct from a quiet zero-activity window",()=>{
 const report=fixture();
 report.research.market={windows:[{window:"5m",buys:0,sells:null,transactions:2,volumeUsd:0}]};
 let html=render("Flow quality",report);
 assert.match(html,/5m activity · partial data/);
 assert.match(counts(html),/<dt[^>]*>Buys<\/dt>\s*<dd[^>]*>0<\/dd>/);
 assert.match(counts(html),/<dt[^>]*>Sells<\/dt>\s*<dd[^>]*>Not available<\/dd>/);
 report.research.market.windows=[{window:"5m",buys:null,sells:null,transactions:0,volumeUsd:null}];
 assert.equal((counts(render("Flow quality",report)).match(/Not available/g)||[]).length,2,"An unsplit zero transaction total is not two observed zero counts");
 report.research.market.windows=[{window:"5m",buys:null,sells:null,volumeUsd:0}];
 assert.equal((counts(render("Flow quality",report)).match(/Not available/g)||[]).length,2,"A volume-only observation does not invent buy/sell counts");
 report.research.market.windows=[{window:"5m",buys:null,sells:null,volumeUsd:null}];
 html=render("Flow quality",report);
 assert.match(html,/Activity data unavailable/);
 assert.equal((counts(html).match(/Not available/g)||[]).length,2);
 assert.doesNotMatch(counts(html),/<dd[^>]*>0<\/dd>/);
 for(const bad of [NaN,Infinity,-1,"0",true,1.5]) assert.equal(tradingActivity({research:{market:{windows:[{window:"5m",buys:bad,sells:bad}]}}}).selected,null);
});

test("activity warning comes after the counts with severity, warning count and the first serious title",()=>{
 const report=fixture();
 report.research.market={windows:[{window:"5m",buys:30,sells:20,volumeUsd:100}]};
 report.findings.push({category:"Market",code:"NO_SELL_FLOW",severity:"warn",title:"No recent sells"},{category:"Distribution",severity:"danger",hardFail:true,title:"High insider concentration"},{category:"Distribution",severity:"danger",title:"Another concentration warning"},{category:"Creator",severity:"danger",title:"Creator has flagged prior launches"});
 const before=JSON.stringify(report),flow=render("Flow quality",report),project=render("Substance",report);
 assert.match(flow,/assessment--red/);
 assert.match(counts(flow),/<dt[^>]*>Buys<\/dt>\s*<dd[^>]*>30<\/dd>/);
 assert.match(counts(flow),/<dt[^>]*>Sells<\/dt>\s*<dd[^>]*>20<\/dd>/);
 assert.match(classContents(flow,"assessment-window"),/5m activity snapshot/);
 const warning=classContents(flow,"assessment-alert");
 assert.match(warning,/2 serious warnings/);
 assert.match(warning,/High insider concentration/);
 assert.ok(flow.indexOf('class="assessment-counts"')<flow.indexOf('class="assessment-alert'),"Visual order must put counts above the warning");
 assert.doesNotMatch(warning,/Another concentration warning|No recent sells/,"Only the highest-priority warning title belongs in the compact alert");
 assert.match(project,/assessment--red/);
 assert.match(project,/<strong class="assessment-status">1 serious warning<\/strong>/);
 assert.equal(JSON.stringify(report),before);
});

test("activity escapes warning titles and retains non-critical warnings below count values",()=>{
 const report=fixture();
 report.research.market={windows:[{window:"5m",buys:1000,sells:868}]};
 report.findings=[{category:"Distribution",severity:"warn",title:'<img src=x onerror="alert(1)">'}];
 const html=render("Flow quality",report),warning=classContents(html,"assessment-alert");
 assert.match(counts(html),/>1,000<\/dd>/);
 assert.match(counts(html),/>868<\/dd>/);
 assert.match(html,/assessment--amber/);
 assert.match(warning,/1 warning/);
 assert.match(warning,/&lt;img/);
 assert.doesNotMatch(html,/<img|<script/);
 assert.ok(html.indexOf('class="assessment-counts"')<html.indexOf('class="assessment-alert'));
});

test("market card leads with market cap then precise token price and evidence-based direction",()=>{
 const report=fixture();
 report.metrics={marketCap:250000,fdv:99999999,priceUsd:0.0000001234};
 report.research.market={windows:[{window:"1h",priceChangePct:12},{window:"5m",priceChangePct:6}]};
 const before=JSON.stringify(report),html=render("Momentum",report);
 assert.match(html,/<h3>Price &amp; market<\/h3>/);
 assert.match(classContents(html,"market-cap-value"),/\$250(?:,000(?:\.00)?|(?:\.0+)?K)/i);
 assert.match(html,/MC · Market cap · USD/);
 assert.match(classContents(html,"market-token-price"),/0\.0000001234/);
 assert.ok(html.indexOf('class="market-cap-value"')<html.indexOf('class="market-token-price"'));
 assert.match(classContents(html,"market-trend-label"),/Running up/);
 assert.match(classContents(html,"market-change-list"),/5m/);
 assert.match(classContents(html,"market-change-list"),/\+6(?:\.0+)?%/);
 assert.match(classContents(html,"market-change-list"),/1h/);
 assert.match(classContents(html,"market-change-list"),/\+12(?:\.0+)?%/);
 assert.match(html,/assessment--green/);
 assert.doesNotMatch(html,/99,999,999|99\.99M|Live price|live quote/i);
 assert.equal(JSON.stringify(report),before,"Rendering cannot change the saved metrics, source windows or risk assessment");
});

test("market trends follow saved changes rather than the previous momentum score",()=>{
 const report=fixture();
 report.momentum.score=80;
 report.research.assessments.find(a=>a.name==="Momentum").status="Strong";
 for(const [changes,label,color] of [
  [[2,3],"Rising","green"],
  [[-4,-8],"Falling","red"],
  [[0.1,-0.2],"Little net change","amber"],
  [[-3,8],"Pulling back","red"],
 ]) {
  report.research.market={windows:[{window:"5m",priceChangePct:changes[0]},{window:"1h",priceChangePct:changes[1]}]};
  const html=render("Momentum",report);
  assert.match(classContents(html,"market-trend-label"),new RegExp(label));
  assert.match(html,new RegExp(`assessment--${color}`));
  assert.doesNotMatch(html,/serious warning/,"A price change is not itself a fraud warning");
 }
 delete report.research.market;
 const html=render("Momentum",report);
 assert.match(html,/assessment--amber/);
 assert.match(classContents(html,"market-trend-label"),/Trend unavailable/);
 assert.doesNotMatch(html,/>Strong<|>Running up<|>Bullish</);
});

test("missing market cap never falls back to FDV while observed zero values remain zero",()=>{
 const report=fixture();
 report.metrics={marketCap:null,fdv:123456789,priceUsd:null};
 let html=render("Momentum",report);
 assert.match(classContents(html,"market-cap-value"),/Not available/);
 assert.match(classContents(html,"market-token-price"),/Not available/);
 assert.doesNotMatch(html,/123,456|123\.4|US\$0/);
 report.metrics.marketCap=0;report.metrics.priceUsd=0;
 html=render("Momentum",report);
 assert.match(classContents(html,"market-cap-value"),/\$0(?:\.00)?/);
 assert.match(classContents(html,"market-token-price"),/\$0(?:\.00)?/);
 for(const invalid of [NaN,Infinity,-1,"123",'<script>alert(1)</script>']) {
  report.metrics.marketCap=invalid;report.metrics.priceUsd=invalid;
  html=render("Momentum",report);
  assert.match(classContents(html,"market-cap-value"),/Not available/);
  assert.match(classContents(html,"market-token-price"),/Not available/);
  assert.doesNotMatch(html,/<script>/);
 }
});

test("market warnings cannot become a green light even with positive saved price changes",()=>{
 const report=fixture();
 report.research.market={windows:[{window:"5m",priceChangePct:6},{window:"1h",priceChangePct:12}]};
 report.findings=[{category:"Market",severity:"warn",code:"MARKET_SOURCE_DISAGREEMENT",title:"Conflicting quotes"}];
 assert.match(render("Momentum",report),/assessment--amber/);
 report.findings=[{category:"Market",severity:"danger",title:"Serious market warning"}];
 assert.match(render("Momentum",report),/assessment--red/);
});

test("card routes cannot escape their local report path and absent IDs stay noninteractive",()=>{
 const report=fixture();
 for(const id of ["../outside?x=1#anchor",'"><script>alert(1)</script>',"https://evil.example/"]) {
  const html=render("Identity",report,id),match=html.match(/href="([^"]+)"/);
  if(match) {
   assert.equal(match[1],`/report/${encodeURIComponent(id)}/identity`);
   assert.equal(new URL(match[1],"https://olwif.example").origin,"https://olwif.example");
  }
  assert.doesNotMatch(html,/<script>|onclick=|href="https:\/\/evil/);
 }
 const fallback=renderToStaticMarkup(React.createElement(AssessmentCard,{assessment:report.research.assessments[0],report}));
 assert.match(fallback,/^<article /);
 assert.doesNotMatch(fallback,/<a\b|View findings|href=/);
 const unexpected=renderToStaticMarkup(React.createElement(AssessmentCard,{assessment:assessment("Unexpected card","Unknown"),report,reportId:REPORT_ID}));
 assert.match(unexpected,/^<article /);
 assert.doesNotMatch(unexpected,/href=/);
});
