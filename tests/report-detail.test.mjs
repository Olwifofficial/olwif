import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import ts from "typescript";
import {presentResearchReport} from "../lib/research/report-presentation.js";
import {displayLinkLabel} from "../lib/research/link-label.js";
import {reportTrafficLight} from "../lib/research/traffic-light.js";
import {projectEvidence} from "../lib/research/project-evidence.js";
import {findReportSection,reportSectionUrl} from "../lib/research/report-sections.js";
import {reportProsCons} from "../lib/research/pros-cons.js";
import {marketSnapshot} from "../lib/research/market-snapshot.js";
import {buyerBehaviour} from "../lib/research/buyer-behaviour.js";
import {ACTIVITY_PERIODS,activityWindow} from "../lib/research/activity-window.js";

const require=createRequire(import.meta.url);
function load(path,stubs={}){
 const source=readFileSync(new URL(path,import.meta.url),"utf8");
 const {outputText}=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}});
 const module={exports:{}};
 new Function("require","module","exports",outputText)(name=>Object.hasOwn(stubs,name)?stubs[name]:require(name),module,module.exports);
 return module.exports;
}
const security=load("../lib/security.ts"),format=load("../lib/format.ts");
const ReportSources=load("../components/report-sources.tsx",{"@/lib/security":security,"@/lib/research/link-label.js":{displayLinkLabel}});
const ReportVerdict=load("../components/report-verdict.tsx",{"@/lib/research/traffic-light.js":{reportTrafficLight},"@/lib/research/report-sections.js":{findReportSection,reportSectionUrl}}).default;
const ProjectProfile=load("../components/project-profile.tsx",{"@/lib/research/project-evidence.js":{projectEvidence}}).default;
const PublicWebResearch=load("../components/public-web-research.tsx",{"@/lib/security":security}).default;
const ProsCons=load("../components/pros-cons.tsx",{"@/lib/research/pros-cons.js":{reportProsCons},"@/lib/research/report-sections.js":{reportSectionUrl}}).default;
const BuyerBehaviour=load("../components/buyer-behaviour.tsx",{"@/lib/research/buyer-behaviour.js":{buyerBehaviour}}).default;
const TradingActivity=load("../components/trading-activity.tsx",{"@/lib/security":security,"@/lib/research/activity-window.js":{ACTIVITY_PERIODS,activityWindow}}).default;
const details=load("../components/report-detail.tsx",{
 "@/components/buyer-behaviour":{__esModule:true,default:BuyerBehaviour},
 "@/components/trading-activity":{__esModule:true,default:TradingActivity},
 "@/lib/research/market-snapshot.js":{marketSnapshot},
 "@/lib/security":security,"@/lib/format":format,"@/lib/research/report-presentation.js":{presentResearchReport},"@/lib/research/link-label.js":{displayLinkLabel},
 "@/components/report-sources":ReportSources,"@/components/report-verdict":{__esModule:true,default:ReportVerdict},"@/components/project-profile":{__esModule:true,default:ProjectProfile},"@/components/public-web-research":{__esModule:true,default:PublicWebResearch},"@/components/pros-cons":{__esModule:true,default:ProsCons}
});
const ReportDetail=details.default;
const findings=[
 {code:"TOKEN_FOUND",category:"Identity",severity:"good",title:"Exact token found on Blockscout",detail:"Example token resolves to the supplied contract."},
 {code:"SERIAL_DEPLOYER",category:"Creator",severity:"warn",title:"Creator has several recent contract creations",detail:"Three contract creations were recorded."},
 {code:"MINT_AUTHORITY_ACTIVE",category:"Authority",severity:"danger",hardFail:true,title:"Mint authority is active",detail:"An address may create additional tokens."},
 {code:"RUGCHECK_RUGGED",category:"On-chain risk",severity:"danger",hardFail:true,title:"Token is marked rugged",detail:"RugCheck's current report marks this mint as rugged."},
 {code:"HONEYPOT",category:"Sellability",severity:"danger",hardFail:true,title:"Honeypot behavior reported",detail:"Selling restriction was returned."},
 {code:"SOURCE_UNVERIFIED",category:"Contract",severity:"warn",title:"Contract source is unverified",detail:"Source needs review."},
 {code:"LIQUIDITY_LOW",category:"Liquidity",severity:"warn",title:"Low liquidity",detail:"A thin pool was returned."},
 {code:"INSIDER_GRAPH",category:"Distribution",severity:"danger",title:"Linked insider network detected",detail:"RugCheck reported 2 insider network(s)."},
 {code:"NO_PROJECT_LINKS",category:"Authenticity",severity:"warn",title:"No indexed project links",detail:"No website links were returned."},
 {code:"NO_SELL_FLOW",category:"Market",severity:"warn",title:"No sells in recent indexed flow",detail:"No sells in the returned window."}
];
const fixture=()=>({target:{chain:"solana",address:"So11111111111111111111111111111111111111112"},identity:{name:"Example",symbol:"EX",chain:"Solana"},generatedAt:"2026-09-24T12:00:00Z",sources:[{name:"Solana mint",ok:true,url:"https://solscan.io/token/example",checkedAt:"2026-09-24T12:00:00Z"}],findings:structuredClone(findings),
 metrics:{supply:"1000000000",decimals:6,holders:0,topHolderPct:4.2,top10Pct:null,insiderPercentage:12,buyTax:0,sellTax:.03,priceUsd:.005,marketCap:20000,liquidityUsd:4500,volume24h:1000,buys1h:20,sells1h:0,topHolders:[{address:"HolderWallet",percentage:4.2,kind:"token account",url:"https://solscan.io/account/HolderWallet"}]},
 research:{classification:"Critical warning found",mainConcern:"A serious warning was returned.",strengths:[],concerns:[],unknowns:["Full audit not performed."],assessments:[],links:[],creator:{address:"CreatorWallet",url:"https://solscan.io/account/CreatorWallet",recentTransactions:40,recentContractCreations:3,previousContracts:[{address:"NewContract",timestamp:"2026-09-22T12:00:00Z"},{address:"OldContract",timestamp:"2026-09-20T12:00:00Z"},{address:"UndatedContract",timestamp:null}]},
 market:{poolUrl:"https://dexscreener.com/solana/pool",windows:[{window:"5m",volumeUsd:50,buys:4,sells:0,transactions:4,priceChangePct:2},{window:"1h",volumeUsd:100,buys:20,sells:0,transactions:20,priceChangePct:4},{window:"6h",volumeUsd:null,buys:null,sells:null,transactions:null,priceChangePct:null},{window:"24h",volumeUsd:1000,buys:70,sells:10,transactions:80,priceChangePct:-5}]},repositories:[{name:"example/code",url:"https://github.com/example/code",archived:null,fork:false,createdAt:null,pushedAt:null}]}});
const render=(section,report=fixture())=>renderToStaticMarkup(React.createElement(ReportDetail,{report,id:"test-report",section}));
const visible=html=>html.replace(/<[^>]*>/g,"");
const main=html=>html.split('<details class="panel report-checks"')[0];

test("all detail sections render content only and retain expandable checks",()=>{
 for(const section of ["summary","identity","integrity","project","momentum","activity"]){
  const html=render(section);assert.match(html,/Checks &amp; gaps/);assert.match(html,new RegExp(`data-report-section="${section}"`));
  assert.doesNotMatch(html,/<main|<header|<h1|site-shell|<script/);
 }
});

test("buyer behaviour appears only in activity, between trading and holder details",()=>{
 const report=fixture();
 const pool="58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2",wallet="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
 report.research.market.pairAddress=pool;
 report.research.buyerActivity={version:1,status:"available",chain:"solana",address:report.target.address,poolAddress:pool,checkedAt:report.generatedAt,source:"GeckoTerminal trades",sourceUrl:`https://api.geckoterminal.com/api/v2/networks/solana/pools/${pool}/trades`,trades:[{id:"solana_first",wallet,side:"buy",tokenAmount:10,priceUsd:1,volumeUsd:10,timestamp:"2026-09-24T11:55:00Z"}]};
 const html=main(render("activity",report));
 assert.match(html,/1 buying addresses across 1 trades/);
 assert.equal((html.match(/id="buyer-behaviour-title"/g)||[]).length,1);
 assert.ok(html.indexOf("Trading activity")<html.indexOf('id="buyer-behaviour-title"'));
 assert.ok(html.indexOf('id="buyer-behaviour-title"')<html.indexOf("Holders &amp; concentration"));
 for(const section of ["summary","identity","integrity","project","momentum"]){
  assert.doesNotMatch(main(render(section,report)),/buyer-behaviour-title|buyer-signal-count|buyer-wallets/);
 }
});

test("saved buyer sample provenance stays in expandable checks with safe evidence links",()=>{
 const report=fixture();
 report.research.buyerActivity={status:"available",checkedAt:report.generatedAt,sourceUrl:"https://api.geckoterminal.com/api/v2/networks/solana/pools/example/trades"};
 const html=render("activity",report),checks=html.slice(html.indexOf('<details class="panel report-checks"'));
 assert.match(checks,/Buyer-behaviour evidence/);assert.match(checks,/Selected-pool wallet trade sample/);
 assert.match(checks,/2026-09-24 12:00:00 UTC/);assert.match(checks,/GeckoTerminal public pool trades/);
 assert.match(checks,/href="https:\/\/api.geckoterminal.com\/api\/v2\/networks\/solana\/pools\/example\/trades"/);
 assert.match(checks,/does not change the token’s safety rating/);
 assert.doesNotMatch(main(html),/Buyer-behaviour evidence/);
 report.research.buyerActivity.sourceUrl="javascript:alert(1)";
 assert.doesNotMatch(render("activity",report),/href="javascript:/);
});

test("summary shows every recorded serious warning even if cached concern list is empty",()=>{
 const html=main(render("summary"));
 for(const title of ["Mint authority is active","Rug-pull warning returned","Honeypot behavior reported","Low liquidity","Possible linked insider network flagged","No sells in recent indexed flow","No indexed project links"]){assert.ok(html.includes(title),title);}
 assert.match(html,/Critical warning found/);assert.doesNotMatch(visible(html),/RugCheck|Blockscout/);
});

test("compact Pros and Cons link to complete findings and keep market context separate",()=>{
 const report=fixture();report.research.whyItMightRun="Recorded market context remains available on the detail page.";
 const before=JSON.stringify(report),html=main(render("summary",report));
 assert.match(html,/<h2[^>]*>(?:<span[^>]*>\+<\/span>)?Pros<\/h2>/);
 assert.match(html,/<h2[^>]*>(?:<span[^>]*>−<\/span>)?Cons<\/h2>/);
 assert.match(html,/href="#finding-details"/);
 assert.match(html,/<div id="all-findings"(?:\s[^>]*)?>/);
 assert.match(html,/<div id="finding-details"(?:\s[^>]*)?>/);
 assert.match(html,/All findings · warnings first/);
 assert.match(html,/<h2>Market context<\/h2><p>Recorded market context remains available on the detail page\.<\/p>/);
 assert.doesNotMatch(html,/What supports the case|What should give you pause|Why it might still run/);
 assert.equal(JSON.stringify(report),before);
});

test("full summary retains standalone cached narratives beyond the compact four-point limit",()=>{
 const report=fixture();report.findings=[];
 report.research.strengths=Array.from({length:7},(_,index)=>`Cached positive evidence ${index+1}: retained without an associated finding code.`);
 report.research.concerns=Array.from({length:6},(_,index)=>`Cached concern ${index+1}: retained without an associated finding code.`);
 const before=JSON.stringify(report),html=main(render("summary",report));
 for(const text of [...report.research.strengths,...report.research.concerns])assert.ok(html.includes(text),`Cached evidence missing from detail page: ${text}`);
 assert.ok(html.indexOf('id="all-findings"')<html.indexOf("Cached positive evidence 1"),"Full findings link must land before the complete cached evidence");
 assert.doesNotMatch(html,/\d+ more in the full findings/);
 assert.equal(JSON.stringify(report),before);
});

test("section findings retain every matching category and actual flow/insider warnings",()=>{
 const integrity=main(render("integrity"));
 for(const title of ["Mint authority is active","Rug-pull warning returned","Honeypot behavior reported","Contract source is unverified","Low liquidity","Possible linked insider network flagged"]){assert.ok(integrity.includes(title),title);}
 const activity=main(render("activity"));assert.match(activity,/No sells in recent indexed flow/);assert.match(activity,/Possible linked insider network flagged/);assert.match(activity,/Honeypot behavior reported/);
 assert.match(main(render("identity")),/Exact token address confirmed/);assert.match(main(render("project")),/No indexed project links/);
});

test("summary retains unfamiliar categories and unknown results after important warnings",()=>{
 const report=fixture();report.findings.unshift({category:"New check category",code:"NEW_GAP",severity:"unknown",title:"Additional evidence missing",detail:"Unknown means unknown."});
 const html=main(render("summary",report));
 assert.match(html,/Additional evidence missing/);assert.match(html,/New check category/);
 assert.ok(html.indexOf("Critical warning · Mint authority")<html.indexOf("Not verified · Additional evidence missing"));
});

test("successful market lookup is not called a verified token identity",()=>{
 const report=fixture();report.sources=[{name:"DEX market",ok:true,checkedAt:"2026-09-24T12:00:00Z"}];
 const html=main(render("identity",report));
 assert.match(html,/Market lookup response/);assert.match(html,/Response returned/);assert.doesNotMatch(html,/Exact market-index match|Matching data returned/);
});

test("empty details never manufacture zero data, positive controls or repository status",()=>{
 for(const section of ["identity","integrity","momentum","activity"]){
  const html=main(render(section,{}));assert.match(html,/Not verified/);assert.doesNotMatch(html,/<dd>0(?:%|<)|US\$0\.00|1970-01-01|<dd>revoked<|<dd>No<|Matching data returned/);
 }
 const project=main(render("project"));assert.match(project,/<dt>Archived<\/dt><dd>Not verified<\/dd>/);assert.match(project,/<dt>Fork<\/dt><dd>No<\/dd>/);
});

test("activity starts at five minutes with recorded zeros distinct from unknown",()=>{
 const html=main(render("activity"));
 assert.match(html,/<option value="5m" selected="">/);
 assert.match(html,/<dt>Buys<\/dt><dd>4<\/dd>/);assert.match(html,/<dt>Sells<\/dt><dd>0<\/dd>/);
 const trading=html.slice(0,html.indexOf('id="buyer-behaviour-title"'));
 assert.doesNotMatch(trading,/<table|Buys · 1 hour|Sells · 1 hour|<dd>20<\/dd>/);
 assert.match(trading,/<details class="activity-period-detail"><summary>More detail<\/summary>/);
 assert.match(html,/<dt>Holder count<\/dt><dd>0<\/dd>/);
 assert.match(html,/<dt>Exposed top 10 combined<\/dt><dd>Not verified<\/dd>/);
 assert.match(main(render("integrity")),/<dt>Buy tax reported<\/dt><dd>0%<\/dd>/);
});

test("momentum retains the full saved market-window comparison",()=>{
 const html=main(render("momentum"));
 for(const label of ["5m","1h","6h","24h"]){assert.match(html,new RegExp(`<th scope="row">${label}<\\/th>`));}
 assert.doesNotMatch(html,/activity-period-control|activity-period-metrics/);
});

test("creator events are oldest first with unknown dates last and no raw report mutations",()=>{
 const report=fixture(),before=JSON.stringify(report),html=main(render("identity",report));
 assert.ok(html.indexOf("OldContract")<html.indexOf("NewContract"));assert.ok(html.indexOf("NewContract")<html.indexOf("UndatedContract"));
 assert.equal(JSON.stringify(report),before);
 for(const section of ["summary","integrity","project","momentum","activity"])render(section,report);
 assert.equal(JSON.stringify(report),before);
});

test("untrusted finding text is escaped and unsafe holder/chart links are never navigable",()=>{
 const report=fixture();report.findings[0].title='<img src=x onerror="alert(1)">';report.findings[0].detail='<script>alert(2)</script>';
 report.metrics.topHolders[0].url="javascript:alert(1)";report.research.market.poolUrl="data:text/html,danger";
 const identity=main(render("identity",report));assert.match(identity,/&lt;img/);assert.match(identity,/&lt;script/);assert.doesNotMatch(identity,/<script|<img/);
 assert.doesNotMatch(main(render("integrity",report)),/href="javascript:/);assert.doesNotMatch(main(render("momentum",report)),/href="data:/);assert.doesNotMatch(main(render("activity",report)),/href="data:/);
});

test("formatters preserve null, numeric and timestamp distinctions",()=>{
 assert.equal(details.detailNumber(null),"Not verified");assert.equal(details.detailNumber(0),"0");assert.equal(details.detailNumber("0"),"Not verified");
 assert.equal(details.detailDate(null),"Not verified");assert.equal(details.detailDate(""),"Not verified");assert.equal(details.detailDate(Infinity),"Not verified");assert.equal(details.detailDate(9e15),"Not verified");
});
