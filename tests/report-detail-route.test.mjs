import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import ts from "typescript";
import * as sections from "../lib/research/report-sections.js";

const require=createRequire(import.meta.url);
const routePath="../app/report/[id]/[section]/page.tsx";
const id="test-snapshot-123";
const slugs=["summary","identity","integrity","project","momentum","activity"];
const fixture=()=>({generatedAt:"2026-09-24T08:00:00Z",target:{chain:"solana",address:"ExactMint"},identity:{name:"Saved Example",symbol:"OLD"},findings:[],research:{assessments:[],links:[]}});
function load(path,resolve){
 const source=readFileSync(new URL(path,import.meta.url),"utf8");
 const {outputText}=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}});
 const module={exports:{}};
 new Function("require","module","exports",outputText)(resolve,module,module.exports);
 return {module:module.exports,source};
}
function harness(rows=[]){
 const calls={db:0,select:null,table:null,predicate:null,limit:null,render:0};
 const schema={id:Symbol("reports.id"),hidden:Symbol("reports.hidden"),payload:Symbol("reports.payload")};
 const notFound=Object.assign(new Error("Report not found"),{code:"NOT_FOUND"});
 const matches=(node,row)=>node.op==="and"?node.items.every(item=>matches(item,row)):Object.is(row[node.column===schema.id?"id":node.column===schema.hidden?"hidden":"unknown"],node.value);
 const query={
  select(value){calls.select=value;return this;},from(value){calls.table=value;return this;},where(value){calls.predicate=value;return this;},
  async limit(value){calls.limit=value;return rows.filter(row=>matches(calls.predicate,row)).slice(0,value).map(row=>({payload:row.payload}));}
 };
 const Capture=props=>{calls.render++;return React.createElement("div",{"data-detail-id":props.id,"data-detail-section":props.section});};
 const {module,source}=load(routePath,name=>{
  if(name==="@/db")return {getDb:()=>{calls.db++;return query;}};
  if(name==="@/db/schema")return {reports:schema};
  if(name==="drizzle-orm")return {eq:(column,value)=>({op:"eq",column,value}),and:(...items)=>({op:"and",items})};
  if(name==="next/navigation")return {notFound:()=>{throw notFound;}};
  if(/^@\/(?:app|components)\//.test(name))return {__esModule:true,default:Capture};
  if(name.startsWith("@/"))return require(fileURLToPath(new URL("../"+name.slice(2),import.meta.url)));
  return require(name);
 });
 return {Page:module.default,calls,schema,notFound,source,Capture};
}

test("detail route rejects unknown and prototype-like sections before touching the database",async()=>{
 for(const section of ["missing","SUMMARY","../identity","summary/anything","__proto__","constructor","toString",""]){
  const h=harness();
  await assert.rejects(h.Page({params:Promise.resolve({id,section})}),error=>error===h.notFound,section);
  assert.equal(h.calls.db,0,`${section} must not query storage`);
 }
});

test("each allowed detail section selects only the exact visible report and uses the stored snapshot",async()=>{
 for(const section of slugs){
  const payload=JSON.stringify(fixture()),h=harness([{id,hidden:false,payload}]);
  const element=await h.Page({params:Promise.resolve({id,section})});
  assert.equal(element.type,h.Capture); assert.equal(element.props.id,id); assert.equal(element.props.section,section);
  assert.deepEqual(element.props.report,fixture());
  assert.equal(h.calls.db,1);assert.deepEqual(h.calls.select,{payload:h.schema.payload});assert.equal(h.calls.table,h.schema);assert.equal(h.calls.limit,1);
  assert.deepEqual(h.calls.predicate,{op:"and",items:[{op:"eq",column:h.schema.id,value:id},{op:"eq",column:h.schema.hidden,value:false}]});
  assert.equal(payload,JSON.stringify(fixture()),"The saved payload must remain unchanged");
 }
});

test("hidden, missing and wrong-id snapshots are inaccessible through all dedicated routes",async()=>{
 const payload=JSON.stringify(fixture());
 for(const section of slugs){
  for(const rows of [[],[{id,hidden:true,payload}],[{id:"another-report",hidden:false,payload}]]){
   const h=harness(rows);
   await assert.rejects(h.Page({params:Promise.resolve({id,section})}),error=>error===h.notFound);
   assert.equal(h.calls.render,0);
  }
 }
});

test("detail navigation does not refresh research or write to report storage",async()=>{
 const payload=JSON.stringify(fixture()),rows=[{id,hidden:false,payload}],before=structuredClone(rows),h=harness(rows);
 const oldFetch=globalThis.fetch;let fetchCalls=0;
 globalThis.fetch=async()=>{fetchCalls++;throw new Error("Navigation must not collect fresh research");};
 try{
  await h.Page({params:Promise.resolve({id,section:"identity"})});
 }finally{globalThis.fetch=oldFetch;}
 assert.equal(fetchCalls,0);assert.deepEqual(rows,before);
 assert.doesNotMatch(h.source,/\/api\/research|scanToken|collectPublicWeb|\.insert\(|\.update\(|\.delete\(/);
});

test("report identifiers remain bound query values rather than altering the visibility predicate",async()=>{
 const unusual="x' OR 1=1 --",h=harness([{id,hidden:false,payload:JSON.stringify(fixture())}]);
 await assert.rejects(h.Page({params:Promise.resolve({id:unusual,section:"summary"})}),error=>error===h.notFound);
 assert.deepEqual(h.calls.predicate,{op:"and",items:[{op:"eq",column:h.schema.id,value:unusual},{op:"eq",column:h.schema.hidden,value:false}]});
});

const detailCalls=[];
const DetailStub=props=>{detailCalls.push(props);return React.createElement("section",{"data-section":props.section},"Stored evidence");};
const DetailPage=load("../components/report-detail-page.tsx",name=>{
 if(name==="@/app/site-shell")return {__esModule:true,default:({children})=>React.createElement("div",null,children)};
 if(name==="@/components/report-detail")return {__esModule:true,default:DetailStub};
 if(name==="@/lib/research/report-sections.js")return sections;
 return require(name);
}).module.default;
const renderDetail=(report,section="identity",reportId=id)=>renderToStaticMarkup(React.createElement(DetailPage,{report,id:reportId,section}));

test("detail pages link back to the same saved report and across six dedicated routes",()=>{
 for(const section of slugs){
  const report=fixture(),before=structuredClone(report),html=renderDetail(report,section);
  assert.equal((html.match(new RegExp(`href="/report/${id}#report-summary"`,"g"))||[]).length,2,"Top and bottom breadcrumbs must return to the same report");
  for(const slug of slugs)assert.ok(html.includes(`href="/report/${id}/${slug}"`),slug);
  assert.equal((html.match(/aria-current="page"/g)||[]).length,1);
  assert.ok(html.includes(`href="/report/${id}/${section}" aria-current="page"`));
  assert.match(html,/aria-label="Research detail sections"/);
  assert.match(html,/Saved check · 2026-09-24 08:00:00 UTC/);
  assert.doesNotMatch(html,/\/api\/research|Refresh check|<form|<button/);
  const call=detailCalls.at(-1);
  assert.equal(call.report,report);assert.equal(call.id,id);assert.equal(call.section,section);
  assert.deepEqual(report,before,"Navigation presentation must not rewrite evidence");
 }
});

test("section helper accepts only declared slugs and produces bounded report-local links",()=>{
 assert.deepEqual(sections.REPORT_SECTIONS.map(item=>item.slug),slugs);
 for(const slug of slugs){assert.equal(sections.findReportSection(slug).slug,slug);assert.equal(sections.reportSectionUrl(id,slug),`/report/${id}/${slug}`);}
 for(const invalid of ["../elsewhere","https://attacker.example/","summary#x","constructor",null,{},42]){
  assert.equal(sections.findReportSection(invalid),null);assert.equal(sections.reportSectionUrl(id,invalid),null);
 }
 for(const invalidId of ["../other","abc?x=1","abc#fragment","javascript:alert(1)","",null,"a".repeat(101)])assert.equal(sections.reportSectionUrl(invalidId,"identity"),null);
});

test("plain-language titles stay consistent across section navigation and page headings without renaming saved assessments",()=>{
 const names=[
  ["summary","O’s take",undefined],
  ["identity","Token check","Identity"],
  ["integrity","Risk checks","Integrity"],
  ["project","People & project","Substance"],
  ["momentum","Price & market","Momentum"],
  ["activity","Buying & selling","Flow quality"],
 ];
 for(const [slug,title,assessment] of names){
  const section=sections.findReportSection(slug),html=renderDetail(fixture(),slug);
  const escapedTitle=title.replaceAll("&","&amp;");
  assert.equal(section.title,title);
  assert.equal(section.assessment,assessment);
  assert.ok(html.includes(`<h1 class="page-title">${escapedTitle}</h1>`),`${slug} heading uses its shared title`);
  assert.ok(html.includes(`aria-current="page">${escapedTitle}</a>`),`${slug} navigation uses its shared title`);
  if(assessment)assert.equal(sections.sectionForAssessment(assessment),slug);
 }
});

test("detail shell safely escapes saved identity and address strings",()=>{
 const report=fixture(),attack='<script>alert("unsafe")</script>';
 report.identity.name=attack;report.target.address=attack;
 const html=renderDetail(report);
 assert.match(html,/&lt;script&gt;alert\(&quot;unsafe&quot;\)&lt;\/script&gt;/);
 assert.doesNotMatch(html,/<script|href="javascript:/);
});

test("invalid detail sections render no shell and missing dates stay unknown",()=>{
 assert.equal(renderDetail(fixture(),"unknown"),"");
 const report=fixture();delete report.generatedAt;
 const html=renderDetail(report);
 assert.match(html,/Saved check · Time not recorded/);assert.doesNotMatch(html,/1970-01-01|Invalid Date/);
});

test("dedicated pages retain required data credit only when the saved snapshot used it",()=>{
 const report=fixture();
 assert.doesNotMatch(renderDetail(report),/Powered by CoinGecko/);
 report.sources=[{name:"GeckoTerminal metadata",ok:true}];
 let html=renderDetail(report);
 assert.match(html,/href="https:\/\/www\.coingecko\.com\/en\/api" target="_blank" rel="noopener noreferrer">Powered by CoinGecko/);
 assert.equal((html.match(/Powered by CoinGecko/g)||[]).length,1);
 report.sources[0].ok=false;
 assert.doesNotMatch(renderDetail(report),/Powered by CoinGecko/);
 report.research.market={corroboration:{provider:"GeckoTerminal"}};
 assert.match(renderDetail(report),/Powered by CoinGecko/);
});
