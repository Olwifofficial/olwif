import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import ts from "typescript";
import {buyerBehaviour} from "../lib/research/buyer-behaviour.js";

const require=createRequire(import.meta.url);
const source=readFileSync(new URL("../components/buyer-behaviour.tsx",import.meta.url),"utf8");
const {outputText}=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}});
const compiledModule={exports:{}};
new Function("require","module","exports",outputText)(name=>name==="@/lib/research/buyer-behaviour.js"?{buyerBehaviour}:require(name),compiledModule,compiledModule.exports);
const BuyerBehaviour=compiledModule.exports.default;

const TOKEN=`0x${"a".repeat(40)}`,POOL=`0x${"c".repeat(40)}`;
const REPEAT=`0x${"d".repeat(40)}`,RECENT=`0x${"e".repeat(40)}`,NET_SELLER=`0x${"f".repeat(40)}`;
const CHECKED="2026-09-24T12:00:00Z";
const trade=(id,wallet,timestamp,side,tokenAmount,priceUsd)=>({id,wallet,timestamp:`2026-09-24T${timestamp}:00Z`,side,tokenAmount,priceUsd,volumeUsd:tokenAmount*priceUsd});
function fixture(){
 return {target:{chain:"ethereum",address:TOKEN},generatedAt:CHECKED,score:18,findings:[{code:"HONEYPOT",severity:"danger",hardFail:true}],research:{market:{pairAddress:POOL},buyerActivity:{
  version:1,status:"available",chain:"ethereum",address:TOKEN,poolAddress:POOL,checkedAt:CHECKED,source:"GeckoTerminal trades",sourceUrl:`https://api.geckoterminal.com/api/v2/networks/eth/pools/${POOL}/trades`,
  trades:[trade("first",REPEAT,"11:40","buy",10,2),trade("again",REPEAT,"11:55","buy",5,1),trade("sell",REPEAT,"11:57","sell",2,1),trade("recent",RECENT,"11:56","buy",4,3),trade("old",NET_SELLER,"11:30","buy",2,1),trade("exit",NET_SELLER,"11:58","sell",3,1)]
 }}};
}
const render=(report=fixture(),reportId="saved-report")=>renderToStaticMarkup(React.createElement(BuyerBehaviour,{report,reportId}));
const card=(html,title)=>{
 const escaped=title.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
 const found=html.match(new RegExp(`<h3>${escaped}</h3><strong class="buyer-signal-count">([^<]+)</strong>`));
 assert.ok(found,`Missing signal card: ${title}`);
 return found[1];
};

test("real saved trades produce four descriptive cards with sample dates and coverage",()=>{
 const html=render();
 assert.match(html,/aria-labelledby="buyer-behaviour-title"/);
 assert.match(html,/<h2 id="buyer-behaviour-title">Buyer behaviour<\/h2>/);
 assert.match(html,/3 buying addresses across 6 trades/);
 assert.match(html,/2026-09-24 11:30:00 UTC/);assert.match(html,/2026-09-24 11:58:00 UTC/);
 assert.equal(card(html,"Newly seen"),"1");assert.equal(card(html,"Buying again"),"1");
 assert.equal(card(html,"Net buying"),"2");assert.equal(card(html,"Buying lower"),"1");
 assert.match(html,/3 buying addresses assessable/);assert.match(html,/1 buying addresses assessable/);
 assert.match(html,/does not mean a first-ever buyer/);assert.match(html,/not confirmed averaging down/);
 assert.match(html,/not counts of individual people/);
});

test("buying-address details are collapsed and link to canonical explorers with accessible full addresses",()=>{
 const html=render();
 assert.match(html,/<details class="buyer-wallets"><summary>Explore buying addresses · 3 shown<\/summary>/);
 assert.doesNotMatch(html,/<details[^>]*\bopen(?:=|\s|>)/);
 for(const wallet of [REPEAT,RECENT,NET_SELLER]){
  assert.ok(html.includes(`href="https://etherscan.io/address/${wallet}" target="_blank" rel="noopener noreferrer" aria-label="Inspect address ${wallet}" title="${wallet}"`));
 }
 assert.match(html,/<caption class="sr-only">Buying address activity in the returned sample<\/caption>/);
 assert.match(html,/<th scope="col">Net tokens<\/th>/);
 assert.match(html,/<td>2 \/ 1<\/td><td>13<\/td>/);
 assert.match(html,/<td>1 \/ 1<\/td><td>-1<\/td>/);
 assert.match(html,/<details class="buyer-method"><summary>How to read these signals<\/summary>/);
 assert.match(html,/Up to 300 returned trades from the past 24 hours/);
 assert.match(html,/Missing amounts or prices are excluded from the relevant signal, not treated as zero/);
});

test("legacy and unavailable reports show explanations without manufactured counts or wallets",()=>{
 const legacy=fixture();delete legacy.research.buyerActivity;
 const legacyHtml=render(legacy);
 assert.match(legacyHtml,/predates the buyer-behaviour check/);
 assert.match(legacyHtml,/href="\/report\/saved-report">Back to report to refresh/);
 const unavailable=[];
 for(const status of ["unavailable","unsupported"]){const report=fixture();report.research.buyerActivity.status=status;unavailable.push(report);}
 const wrongPool=fixture();wrongPool.research.market.pairAddress=`0x${"b".repeat(40)}`;unavailable.push(wrongPool);
 const malformed=fixture();malformed.research.buyerActivity.version=999;unavailable.push(malformed);
 for(const report of unavailable){
  const html=render(report);
  assert.match(html,/usable wallet-level trade sample was not returned/);
  assert.doesNotMatch(html,/Back to report to refresh/);
 }
 for(const html of [legacyHtml,...unavailable.map(report=>render(report)),render({})]){
  assert.doesNotMatch(html,/buyer-signal-count|buyer-wallets|<table|0 buying addresses|across 0 trades/);
 }
});

test("missing amounts and comparison prices stay unknown while actual empty samples keep recorded zero counts",()=>{
 const missing=fixture();missing.research.buyerActivity.trades=[trade("first",REPEAT,"11:50","buy",null,null),trade("second",REPEAT,"11:55","buy",null,null)];
 const html=render(missing);
 assert.equal(card(html,"Buying again"),"1");
 assert.equal(card(html,"Net buying"),"Not enough data");assert.equal(card(html,"Buying lower"),"Not enough data");
 assert.match(html,/<td>2 \/ 0<\/td><td>Not enough data<\/td>/);
 const empty=fixture();empty.research.buyerActivity.trades=[];
 const emptyHtml=render(empty);
 assert.match(emptyHtml,/0 buying addresses across 0 trades/);
 assert.equal(card(emptyHtml,"Newly seen"),"0");assert.equal(card(emptyHtml,"Buying again"),"0");
 assert.equal(card(emptyHtml,"Net buying"),"Not enough data");assert.equal(card(emptyHtml,"Buying lower"),"Not enough data");
 assert.doesNotMatch(emptyHtml,/buyer-wallets/);
});

test("untrusted wallet and source values cannot introduce raw HTML or arbitrary links",()=>{
 const report=fixture();
 report.research.buyerActivity.source='<img src=x onerror="alert(1)">';
 report.research.buyerActivity.sourceUrl="javascript:alert(1)";
 report.research.buyerActivity.poolUrl="data:text/html,<script>alert(2)</script>";
 report.research.buyerActivity.wallets=[{wallet:REPEAT,url:"javascript:alert(3)"}];
 report.research.buyerActivity.trades.push(trade("injected",'<img src=x onerror="alert(4)">',"11:59","buy",1,1));
 report.research.buyerActivity.trades[0].url="https://attacker.example/wallet";
 const html=render(report);
 assert.match(html,/3 buying addresses across 6 trades/);
 assert.doesNotMatch(html,/<script|<img|onerror=|javascript:|data:text\/html|attacker\.example/);
 assert.match(html,/href="https:\/\/etherscan.io\/address\//);
 const legacy=fixture();delete legacy.research.buyerActivity;
 assert.ok(render(legacy,'"><img src=x>').includes('href="/report/%22%3E%3Cimg%20src%3Dx%3E"'));
});

test("signals do not use safety verdict classes or recommend a trade",()=>{
 const html=render();
 const classes=[...html.matchAll(/class="([^"]*)"/g)].flatMap(match=>match[1].split(/\s+/));
 for(const token of classes)assert.doesNotMatch(token,/^(?:good|warn|danger|success|critical|safe|green|red|amber)$|traffic-light|verdict|risk-score/);
 assert.doesNotMatch(html,/style="[^"]*(?:green|red|amber)|strong buy|buy now|safe to buy|confirmed accumulation/i);
 assert.match(html,/none of these signals prove organic demand/);
});

test("rendering available, unavailable and legacy reports performs no fetch or report mutation",t=>{
 const fetch=t.mock.method(globalThis,"fetch",()=>{throw new Error("Rendering must not fetch");});
 const report=fixture(),before=structuredClone(report);
 render(report);render(report);
 assert.deepEqual(report,before);
 report.research.buyerActivity.status="unavailable";render(report);
 delete report.research.buyerActivity;render(report);render({});
 assert.equal(fetch.mock.callCount(),0);
});
