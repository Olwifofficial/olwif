import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import ts from "typescript";
import {ACTIVITY_PERIODS,activityWindow} from "../lib/research/activity-window.js";

const require=createRequire(import.meta.url);
function load(path,stubs={}){
 const source=readFileSync(new URL(path,import.meta.url),"utf8");
 const {outputText}=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}});
 const compiledModule={exports:{}};
 new Function("require","module","exports",outputText)(name=>Object.hasOwn(stubs,name)?stubs[name]:require(name),compiledModule,compiledModule.exports);
 return compiledModule.exports;
}
const security=load("../lib/security.ts");
const dependencies={"@/lib/security":security,"@/lib/research/activity-window.js":{ACTIVITY_PERIODS,activityWindow}};
const TradingActivity=load("../components/trading-activity.tsx",dependencies).default;
const TOKEN=`0x${"a".repeat(40)}`,POOL=`0x${"c".repeat(40)}`,WALLET=`0x${"d".repeat(40)}`;
const CHECKED="2026-09-24T12:00:00Z";
const trade=(id,time,side,volumeUsd)=>({id,wallet:WALLET,timestamp:`2026-09-24T${time}Z`,side,tokenAmount:volumeUsd,priceUsd:1,volumeUsd});
function fixture(){
 return {target:{chain:"ethereum",address:TOKEN},generatedAt:CHECKED,score:18,findings:[{code:"HONEYPOT",severity:"danger",hardFail:true}],research:{
  market:{pairAddress:POOL,poolUrl:`https://dexscreener.com/ethereum/${POOL}`,windows:[
   {window:"5m",buys:40,sells:0,transactions:40,volumeUsd:1200,priceChangePct:2},
   {window:"1h",buys:120,sells:20,transactions:140,volumeUsd:9000,priceChangePct:8}
  ]},
  buyerActivity:{version:1,status:"available",chain:"ethereum",address:TOKEN,poolAddress:POOL,checkedAt:CHECKED,source:"GeckoTerminal trades",sourceUrl:`https://api.geckoterminal.com/api/v2/networks/eth/pools/${POOL}/trades`,trades:[
   trade("older","11:40:00","buy",100),trade("buy","11:55:00","buy",20),trade("sell","11:58:00","sell",10),trade("latest","11:59:30","buy",30)
  ]}
 }};
}
function render(report=fixture(),period){
 // Substituting the hook's selected value exercises real component markup and
 // the real saved-data helper without invoking React hooks outside a render.
 const Component=period===undefined?TradingActivity:load("../components/trading-activity.tsx",{...dependencies,react:{...React,useState:()=>[period,()=>{}]}}).default;
 return renderToStaticMarkup(React.createElement(Component,{report}));
}
const metrics=html=>html.match(/<dl class="activity-period-metrics">(.*?)<\/dl>/)?.[1]??"";

test("the compact activity summary defaults to five minutes with an accessible selector and live result",()=>{
 const html=render(),values=metrics(html);
 assert.match(html,/<h2 id="([^"]+)-heading">Trading activity<\/h2>/);
 const selector=html.match(/<select id="([^"]+)">/);
 assert.ok(selector,"A labelled time-window selector is available");
 assert.ok(html.includes(`htmlFor="${selector[1]}"`)||html.includes(`for="${selector[1]}"`));
 assert.match(html,/<span>Time window<\/span>/);
 for(const period of ["1m","5m","10m","15m","30m","1h","6h","24h"]){assert.ok(html.includes(`<option value="${period}"`),`Missing ${period} option`);}
 assert.match(html,/<option value="5m" selected="">/);
 assert.equal((html.match(/ selected=""/g)||[]).length,1);
 assert.match(html,/role="status" aria-live="polite" aria-atomic="true"/);
 assert.match(values,/<dt>Buys<\/dt><dd>40<\/dd>/);assert.match(values,/<dt>Sells<\/dt><dd>0<\/dd>/);
 assert.match(values,/<dt>Volume · USD<\/dt><dd title="\$1,200\.00" aria-label="\$1,200\.00">\$1\.20K<\/dd>/);
 assert.equal((values.match(/<dt>/g)||[]).length,3);
 assert.match(html,/Market snapshot/);assert.match(html,/Saved check, not live/);
 assert.doesNotMatch(html,/<table|<dd>120<\/dd>|Buys · 1 hour/);
});

test("one- and ten-minute selections show their own sampled trades rather than scaling the five-minute snapshot",()=>{
 const minute=render(fixture(),"1m"),tenMinutes=render(fixture(),"10m");
 assert.match(minute,/<option value="1m" selected="">/);assert.match(tenMinutes,/<option value="10m" selected="">/);
 assert.match(metrics(minute),/<dt>Buys<\/dt><dd>1<\/dd>/);assert.match(metrics(minute),/<dt>Sells<\/dt><dd>0<\/dd>/);
 assert.match(metrics(minute),/aria-label="\$30\.00"/);
 assert.match(metrics(tenMinutes),/<dt>Buys<\/dt><dd>2<\/dd>/);assert.match(metrics(tenMinutes),/<dt>Sells<\/dt><dd>1<\/dd>/);
 assert.match(metrics(tenMinutes),/aria-label="\$60\.00"/);
 for(const html of [minute,tenMinutes]){
  assert.match(html,/Sampled trades|Partial sample/);assert.doesNotMatch(html,/Market snapshot|<dd>40<\/dd>|\$1\.20K/);
  assert.match(html,/activity-period-note/);assert.match(html,/saved individual trades/);
 }
});

test("incomplete sample coverage is explained and missing volume remains unavailable",()=>{
 const report=fixture();
 report.research.buyerActivity.trades=[trade("recent","11:59:30","buy",null)];
 const html=render(report,"10m");
 assert.match(html,/Partial sample/);assert.match(html,/activity-period-note/);
 assert.match(metrics(html),/<dt>Buys<\/dt><dd>1<\/dd>/);
 assert.match(metrics(html),/aria-label="Volume not available">—<\/dd>/);
 assert.doesNotMatch(metrics(html),/\$0/);
});

test("two swaps in the same chain transaction are labelled as sampled trades",()=>{
 const report=fixture(),txHash=`0x${"f".repeat(64)}`;
 report.research.buyerActivity.trades=[
  trade("older","11:40:00","buy",100),
  {...trade("swap-one","11:59:30","buy",20),txHash},
  {...trade("swap-two","11:59:30","sell",10),txHash}
 ];
 const html=render(report,"1m");
 assert.match(html,/<dt>Sampled trades<\/dt><dd>2<\/dd>/);
 assert.doesNotMatch(html,/<dt>Transactions<\/dt>/);
 assert.match(metrics(html),/<dt>Buys<\/dt><dd>1<\/dd>/);assert.match(metrics(html),/<dt>Sells<\/dt><dd>1<\/dd>/);
});

test("missing history and mismatched pools do not turn unknown short periods into zero activity",()=>{
 const legacy=fixture();delete legacy.research.buyerActivity;
 const wrongPool=fixture();wrongPool.research.buyerActivity.poolAddress=`0x${"e".repeat(40)}`;
 const unavailable=fixture();unavailable.research.buyerActivity.status="unavailable";
 for(const report of [legacy,wrongPool,unavailable,{}]){
  const html=render(report,"1m"),values=metrics(html);
  assert.match(html,/No saved data/);assert.match(html,/activity-period-note/);
  assert.match(values,/aria-label="Buys not available">—<\/dd>/);assert.match(values,/aria-label="Sells not available">—<\/dd>/);
  assert.match(values,/aria-label="Volume not available">—<\/dd>/);
  assert.doesNotMatch(values,/<dd>0<\/dd>|\$0/);
 }
 assert.match(metrics(render(legacy)),/<dt>Buys<\/dt><dd>40<\/dd>/,"Legacy indexed five-minute evidence remains usable");
});

test("secondary facts and the selected-pool link stay inside collapsed More detail",()=>{
 const html=render(),details=html.slice(html.indexOf('<details class="activity-period-detail"'));
 assert.match(html,/<details class="activity-period-detail"><summary>More detail<\/summary>/);
 assert.doesNotMatch(html,/<details[^>]*\bopen(?:=|\s|>)/);
 assert.match(details,/<dt>Transactions<\/dt><dd>40<\/dd>/);assert.match(details,/<dt>Price change<\/dt><dd>2%<\/dd>/);
 assert.match(details,/2026-09-24 12:00:00 UTC/);assert.match(details,/Selected period:/);
 assert.match(details,/Trades are not unique people/);assert.match(details,/buyer-behaviour section below keeps its own labelled sample period/);
 assert.ok(details.includes(`href="https://dexscreener.com/ethereum/${POOL}" target="_blank" rel="noopener noreferrer"`));
 assert.match(details,/Inspect selected pool/);
 assert.doesNotMatch(html,/<table/);
});

test("unsafe selected-pool links are omitted",()=>{
 for(const poolUrl of ["javascript:alert(1)","data:text/html,<script>alert(1)</script>","https://user:password@example.com/pool"]){
  const report=fixture();report.research.market.poolUrl=poolUrl;
  const html=render(report);
  assert.doesNotMatch(html,/href=|<script|javascript:|data:text\/html|user:password/);
 }
});

test("changing displayed periods performs no fetch or report mutation",t=>{
 const fetch=t.mock.method(globalThis,"fetch",()=>{throw new Error("Showing saved activity must not fetch");});
 const report=fixture(),before=structuredClone(report);
 for(const period of [undefined,"1m","10m","1h","6h","24h"])render(report,period);
 assert.deepEqual(report,before);
 report.research.buyerActivity.status="unavailable";render(report,"1m");
 delete report.research.buyerActivity;render(report,"10m");render({});
 assert.equal(fetch.mock.callCount(),0);
});
