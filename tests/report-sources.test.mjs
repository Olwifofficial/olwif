import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import ts from "typescript";
import {presentResearchReport} from "../lib/research/report-presentation.js";
import {displayLinkLabel} from "../lib/research/link-label.js";
import {projectEvidence} from "../lib/research/project-evidence.js";
import {reportProsCons} from "../lib/research/pros-cons.js";
import {reportSectionUrl} from "../lib/research/report-sections.js";

const require=createRequire(import.meta.url);
const source=path=>readFileSync(new URL(path,import.meta.url),"utf8");
function load(path,stubs={}) {
 const {outputText}=ts.transpileModule(source(path),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}});
 const module={exports:{}};
 new Function("require","module","exports",outputText)(name=>Object.hasOwn(stubs,name)?stubs[name]:require(name),module,module.exports);
 return module.exports;
}
const security=load("../lib/security.ts"),format=load("../lib/format.ts");
const sourcesModule=load("../components/report-sources.tsx",{"@/lib/security":security,"@/lib/research/link-label.js":{displayLinkLabel}});
const ReportSources=sourcesModule.default;
const PublicWebResearch=load("../components/public-web-research.tsx",{"@/lib/security":security}).default;
const ProjectProfile=load("../components/project-profile.tsx",{"@/lib/research/project-evidence.js":{projectEvidence}}).default;
const ProsCons=load("../components/pros-cons.tsx",{"@/lib/research/pros-cons.js":{reportProsCons},"@/lib/research/report-sections.js":{reportSectionUrl}}).default;
const finding={code:"INSIDER_GRAPH",title:"Linked insider network detected",detail:"RugCheck reported 2 insider network(s).",category:"Distribution",severity:"danger",hardFail:false};
const noWarnings={code:"RUGCHECK_NO_LISTED_RISKS",title:"No RugCheck warnings returned",detail:"This is a useful signal, not a guarantee that the creator or market is safe.",category:"On-chain risk",severity:"good"};
const fixture=()=>({
 target:{address:"So11111111111111111111111111111111111111112",chain:"solana"},
 generatedAt:"2026-09-24T12:00:00Z",identity:{name:"Example token",symbol:"EX",chain:"Solana",description:"A project claim, not an established fact.",descriptionSource:"GeckoTerminal metadata — project claims, not verified",creatorSource:"RugCheck creator field"},
 riskScore:45,confidence:60,tier:"CAUTION",findings:[{...finding},{...noWarnings}],
 metrics:{holders:null,holdersSource:"Conflicting source snapshots",holdersUpdatedAt:null,holdersNote:"Conflicting holder observations remain unverified.",
  holderCountObservations:[{count:0,source:"RugCheck report",fetchedAt:"2026-09-24T11:59:00Z",upstreamUpdatedAt:null},{count:1234,source:"GeckoTerminal metadata",fetchedAt:"2026-09-24T11:59:01Z",upstreamUpdatedAt:"2026-09-24T11:30:00Z"},{count:null,source:"Missing observation",fetchedAt:null,upstreamUpdatedAt:null}],
  topHolders:[{address:"HolderWallet",percentage:4.2,source:"RugCheck snapshot",kind:"token account",url:"https://solscan.io/account/HolderWallet"}],priceUsd:1.23,marketCap:12000},
 sources:[{name:"RugCheck",provider:"api.rugcheck.xyz",checkedAt:"2026-09-24T11:59:00Z",ok:true,url:"https://rugcheck.xyz/tokens/example",message:"RugCheck snapshot received"},{name:"Solana mint",provider:"node.example",checkedAt:"2026-09-24T11:58:00Z",ok:false,error:"Unavailable",attempts:[{provider:"first-node.example",ok:false,error:"Timeout"},{provider:"second-node.example",ok:false,error:"Rate limited"}]}],
 research:{strengths:[`${noWarnings.title}: ${noWarnings.detail}`],concerns:[`${finding.title}: ${finding.detail}`],unknowns:["Complete creator history is unknown."],mainConcern:finding.detail,whyItMightRun:"Speculative demand can move thin markets.",assessments:[],
  creator:{address:"CreatorWallet",url:"https://solscan.io/account/CreatorWallet",source:"RugCheck creator field",historyCoverage:"Only a limited transaction window was checked",recentTransactions:10},
  links:[{kind:"website",label:"Project website",url:"https://project.example/",source:"GeckoTerminal metadata"},{kind:"risk",label:"RugCheck report",url:"https://rugcheck.xyz/tokens/example",source:"RugCheck"},{kind:"market",label:"GeckoTerminal market",url:"https://www.geckoterminal.com/solana/pools/example",source:"GeckoTerminal"}],
  market:{provider:"DEX Screener",poolUrl:"https://dexscreener.com/solana/example",windows:[],corroboration:{provider:"GeckoTerminal",url:"https://www.geckoterminal.com/solana/pools/example"}},
  repositories:[{name:"example/project",url:"https://github.com/example/project",description:"Public project repository",source:"GitHub public API",archived:false,fork:false,attributionVerified:false}],repositoryCoverage:"At most two directly reported repositories checked.",freshness:{description:"Fresh request; provider indexing/cache delay may apply"}},
});
const renderSources=report=>renderToStaticMarkup(React.createElement(ReportSources,{report}));
const textOnly=html=>html.replace(/<[^>]*>/g,"");

test("public web checks keep material coverage without provider or billing narration",()=>{
 const report=fixture();
 report.research.webResearch={search:{provider:"Tavily",status:"not_configured",message:"Free account connection needed"},pages:[{title:"Project page",url:"https://project.example/",discoveredVia:"Token metadata",association:"reported-link"}]};
 let html=renderSources(report);
 assert.match(html,/>Not checked</);
 assert.doesNotMatch(textOnly(html),/Tavily|Free account|not_configured|reported-link/);
 assert.match(html,/Reported project link; ownership not verified/);
 assert.doesNotMatch(html,/not_configured|reported-link/);
 report.research.webResearch.search.status="limited";
 report.research.webResearch.pages[0].association="exact-address";
 html=renderSources(report);
 assert.match(html,/>Incomplete</);
 assert.doesNotMatch(html,/free-only|paid fallback|free account/);
 assert.match(html,/Exact address found in page text; ownership not verified/);
});

test("Checks preserves evidence values and timestamps while disclosing providers in Terms",()=>{
 const report=fixture(),before=JSON.stringify(report),html=renderSources(report);
 for(const text of ["Checks at a glance","CreatorWallet","Token security · Check 1","Token identity &amp; controls · Check 2","Repository: example/project","2026-09-24 11:59:00 UTC","Project website","Holder balances","token account","4.2%","Complete creator history is unknown."]) assert.ok(html.includes(text),`Missing evidence: ${text}`);
 assert.doesNotMatch(textOnly(html),/RugCheck|GeckoTerminal|DEX Screener|GitHub public API|first-node|second-node|Rate limited|Saved finding wording/);
 assert.match(html,/href="\/terms#research-providers"/);
 assert.match(html,/>Security report<svg/);
 assert.match(html,/>Market chart<svg/);
 assert.match(html,/href="https:\/\/project\.example\/"/);
 assert.match(html,/href="https:\/\/github\.com\/example\/project"/);
 assert.match(html,/Project ownership and code quality are not verified/);
 assert.equal(JSON.stringify(report),before,"Rendering must not rewrite saved evidence");
});

test("holder provenance distinguishes zero, unavailable counts and source update times",()=>{
 const html=renderSources(fixture());
 assert.match(html,/<td>Snapshot 1<\/td><td>0<\/td><td>2026-09-24 11:59:00 UTC<\/td><td>Not supplied<\/td>/);
 assert.match(html,/<td>Snapshot 2<\/td><td>1,234<\/td><td>2026-09-24 11:59:01 UTC<\/td><td>2026-09-24 11:30:00 UTC<\/td>/);
 assert.match(html,/<td>Snapshot 3<\/td><td>Not verified<\/td><td>Not supplied<\/td><td>Not supplied<\/td>/);
 assert.match(html,/Holder counts disagree/);
 assert.doesNotMatch(html,/1970-01-01/);
 const minimal=renderSources({});
 assert.match(minimal,/No check records were saved/);
 assert.match(minimal,/Not verified/);
});

test("check time is distinct from data age without narrating fallback mechanics",()=>{
 const report=fixture();
 report.sources[0].upstreamUpdatedAt="2026-09-24T11:20:00Z";
 report.sources[0].snapshot=true;
 const html=renderSources(report);
 assert.match(html,/Checked: 2026-09-24 11:59:00 UTC/);
 assert.match(html,/Data updated: 2026-09-24 11:20:00 UTC/);
 assert.match(html,/A recorded snapshot was received/);
 assert.match(html,/Data updated: Not supplied/);
 assert.doesNotMatch(html,/Fallback snapshot/);
});

test("Sources escapes third-party text and rejects unsafe link schemes or credentials",()=>{
 const report=fixture();
 report.sources[0].name='<script>alert("source")</script>';
 report.sources[0].url="javascript:alert(1)";
 report.findings[0].detail='<img src=x onerror="alert(1)">';
 report.research.creator.url="https://user:secret@example.com/";
 report.research.links=[{kind:"website",label:"<svg onload=alert(1)>",url:"data:text/html,bad",source:"<b>unsafe</b>"}];
 report.research.repositories[0].url="javascript:alert(2)";
 report.research.repositories[0].name='<script>alert("repository")</script>';
 report.research.webResearch={pages:[{title:'<img src=x onerror="alert(1)">',url:"data:text/html,bad"}]};
 const html=renderSources(report);
 assert.match(html,/&lt;script&gt;/);
 assert.match(html,/&lt;img src=x/);
 assert.match(html,/&lt;svg onload/);
 assert.doesNotMatch(html,/&lt;b&gt;unsafe&lt;\/b&gt;/,"Operational attribution is not shown");
 assert.doesNotMatch(html,/<script>|<img src=x|<svg onload|href="(?:javascript:|data:|https:\/\/user:secret)/);
 assert.match(html,/<span>CreatorWallet<\/span>/);
});

function loadView(activeTab,buttons=[]) {
 const passthrough=({children})=>React.createElement(React.Fragment,null,children);
 const Button=({children,onClick,disabled})=>{buttons.push({children,onClick});return React.createElement("button",{disabled},children);};
 const ReportVerdict=({report})=>React.createElement("aside",null,report.research.mainConcern);
 const AssessmentCard=({assessment})=>React.createElement("article",null,assessment.name,assessment.status,assessment.summary);
 return load("../app/report-view.tsx",{
  "./site-shell":{__esModule:true,default:passthrough},
  "@/components/ui/tabs":{Tabs:passthrough,TabsList:passthrough,TabsTrigger:passthrough,TabsContent:({value,children})=>value===activeTab?React.createElement("section",{"data-tab":value},children):null},
  "@/components/ui/button":{Button},"@/lib/security":security,"@/lib/format":format,
  "@/components/report-verdict":{__esModule:true,default:ReportVerdict},"@/components/assessment-card":{__esModule:true,default:AssessmentCard},"@/components/report-sources":sourcesModule,
  "@/components/public-web-research":{__esModule:true,default:PublicWebResearch},
  "@/components/project-profile":{__esModule:true,default:ProjectProfile},
  "@/components/pros-cons":{__esModule:true,default:ProsCons},
  "@/components/save-to-account":{__esModule:true,default:()=>null},
  "@/components/report-celebration":{__esModule:true,default:()=>null},
  "@/lib/research/report-presentation.js":{presentResearchReport},
  "@/lib/research/link-label.js":{displayLinkLabel},
 }).default;
}
function renderView(report,tab,buttons=[]) {
 return renderToStaticMarkup(React.createElement(loadView(tab,buttons),{report,id:"saved-report"}));
}

test("reports do not hand research off to external search engines",()=>{
 const report=fixture();
 for(const tab of ["overview","people","onchain","market","sources"]) {
  const html=renderView(report,tab);
  assert.doesNotMatch(html,/Keep following the trail|Search on Google|Search on Brave|Connected web search/);
  assert.doesNotMatch(html,/href="https:\/\/(?:www\.google\.com|search\.brave\.com)\/search/);
 }
 const people=renderView(report,"people");
 assert.match(people,/Who made it\?/);
 assert.match(people,/Selected pool created/);
 assert.doesNotMatch(people,/First indexed pool/);
 assert.match(renderView(report,"market"),/Selected pool created/);
 assert.match(people,/Code &amp; development/);
 assert.match(people,/href="https:\/\/github\.com\/example\/project"/);
 const sources=renderView(report,"sources");
 assert.match(sources,/Checks at a glance/);
 assert.match(sources,/href="https:\/\/project\.example\/"/);
 assert.match(sources,/Web search, social-post analysis, website content review and complete creator histories are not automatically verified/);
 assert.doesNotMatch(source("../app/report-view.tsx"),/searchWeb|setWebBusy|\/api\/web-search/);
});

test("old and new social links show X in Overview and Sources without changing saved URLs",()=>{
 const report=fixture();
 report.research.links.push({kind:"social",label:"twitter",url:"https://twitter.com/example",source:"GeckoTerminal metadata"});
 const before=JSON.stringify(report);
 for(const tab of ["overview","sources"]) {
  const html=renderView(report,tab);
  assert.match(html,/href="https:\/\/twitter.com\/example"[^>]*>X<svg/);
  assert.doesNotMatch(textOnly(html),/\btwitter\b/i);
 }
 assert.equal(JSON.stringify(report),before);
});

test("all report tabs use plain-language findings and no branded narration",()=>{
 const report=fixture(),before=JSON.stringify(report);
 for(const tab of ["overview","people","onchain","market","sources"]) {
  const text=textOnly(renderView(report,tab));
  assert.doesNotMatch(text,/RugCheck|DEX Screener|GeckoTerminal|GoPlus|Blockscout/,`${tab} should not narrate data-provider names`);
 }
 assert.match(textOnly(renderView(report,"onchain")),/security check flags 2 possible insider network/);
 const sources=textOnly(renderView(report,"sources"));
 assert.doesNotMatch(sources,/RugCheck reported 2 insider network\(s\)|GeckoTerminal metadata/);
 assert.match(sources,/Checks &amp; gaps/);
 assert.doesNotMatch(sources,/Sources &amp; gaps|provider endpoints/);
 assert.equal(JSON.stringify(report),before);
 report.identity.description="Our project claims an integration with RugCheck.";
 assert.match(textOnly(renderView(report,"people")),/Our project claims an integration with RugCheck\./,"Project claims must not be blindly rewritten");
});

test("Download exports original evidence rather than the presentation projection",async()=>{
 const report=fixture(),before=JSON.stringify(report),buttons=[];
 renderView(report,"overview",buttons);
 const save=buttons.find(button=>textOnly(renderToStaticMarkup(React.createElement(React.Fragment,null,button.children))).includes("Download"));
 assert.equal(typeof save?.onClick,"function");
 const originalDocument=globalThis.document,originalTimeout=globalThis.setTimeout;
 const originalCreate=URL.createObjectURL,originalRevoke=URL.revokeObjectURL;
 let capturedBlob,clicked=false;
 try {
  globalThis.document={createElement:()=>({click(){clicked=true;}})};
  globalThis.setTimeout=()=>0;
  URL.createObjectURL=blob=>{capturedBlob=blob;return "blob:test-report";};
  URL.revokeObjectURL=()=>{};
  save.onClick();
  assert.equal(clicked,true);
  const saved=JSON.parse(await capturedBlob.text());
  assert.equal(saved.findings[0].detail,"RugCheck reported 2 insider network(s).");
  assert.equal(saved.research.creator.source,"RugCheck creator field");
  assert.equal(saved.metrics.holderCountObservations[0].count,0);
  assert.equal(saved.findings[1].title,"No RugCheck warnings returned");
  assert.deepEqual(saved.research.unknowns,report.research.unknowns,"Removed Overview panel must not remove saved coverage gaps");
  for(const legacy of ["riskScore","confidence","tier"]) assert.equal(Object.hasOwn(saved,legacy),false);
  assert.equal(JSON.stringify(report),before);
 } finally {
  if(originalDocument===undefined) delete globalThis.document; else globalThis.document=originalDocument;
  globalThis.setTimeout=originalTimeout;
  URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke;
 }
});

test("an empty risk list remains limited context beside a critical warning in legacy reports",()=>{
 const report=fixture();
 report.findings.push({code:"RUGCHECK_RUGGED",severity:"danger",hardFail:true,title:"Token is marked rugged",detail:"RugCheck's current report marks this mint as rugged.",category:"On-chain risk"});
 const html=renderView(report,"onchain");
 assert.match(html,/<div class="finding info"><strong>Limited check · No additional warnings in the risk list/);
 assert.match(html,/Critical warning · Rug-pull warning returned/);
 assert.doesNotMatch(html,/Check passed · No additional warnings/);
 assert.doesNotMatch(textOnly(renderView(report,"overview")),/No additional warnings in the risk list/);
 assert.equal(report.findings[1].severity,"good","Historical evidence remains unchanged");
});

test("failed, paused and unconfigured checks remain distinct without raw operational messages",()=>{
 const report=fixture();
 report.sources.push({name:"GoPlus security",ok:false,error:"This source is paused by the site owner."},{name:"Blockscout holders",ok:false,error:"This source is not configured for this chain. Explorer links are provided for manual review."},{name:"__proto__",ok:false,message:"Tavily free plan paid fallback endpoint",error:"403 confidential diagnostic"});
 report.research.webResearch={search:{provider:"Tavily",status:"paused",message:"Web search is paused by the owner."},summary:["Public-page reading is paused by the owner."],checks:[],pages:[]};
 const before=JSON.stringify(report),html=renderSources(report);
 for(const label of ["Data returned","Not verified","Paused","Not checked"]) assert.ok(html.includes(`>${label}<`));
 assert.match(html,/Public-page reading is paused/);
 assert.match(html,/Additional check 5/);
 assert.doesNotMatch(textOnly(html),/RugCheck|GoPlus|Blockscout|Tavily|403|confidential|paid fallback|free plan|endpoint/);
 assert.equal(JSON.stringify(report),before);
});

test("known failed-check messages stay as plain evidence gaps in On-chain and Checks",()=>{
 const report=fixture();
 const missing={code:"RUGCHECK_UNAVAILABLE",severity:"unknown",category:"On-chain risk",title:"Independent Solana risk report unavailable",detail:"RugCheck endpoint returned 403; paid fallback disabled"};
 report.findings.push(missing);
 report.research.unknowns.push(`${missing.title}: ${missing.detail}`);
 const before=JSON.stringify(report);
 for(const tab of ["onchain","sources"]) {
  const html=renderView(report,tab);
  assert.match(textOnly(html),/token-security check did not return usable results/);
  assert.doesNotMatch(textOnly(html),/endpoint returned 403|paid fallback disabled/);
 }
 assert.equal(JSON.stringify(report),before);
});

test("Overview removes the generic unknowns panel without hiding concerns or deleting coverage gaps",()=>{
 const report=fixture();
 report.research.unknowns.push("Team identity remains unknown.","Historical holder growth has not been checked.");
 const before=JSON.stringify(report),overview=renderView(report,"overview");
 assert.doesNotMatch(overview,/What we still don[’']t know|What remains unverified/);
 for(const gap of report.research.unknowns) assert.ok(!overview.includes(gap),`Overview should not repeat the generic gap: ${gap}`);
 assert.match(overview,/<h2[^>]*>(?:<span[^>]*>\+<\/span>)?Pros<\/h2>/);
 assert.match(overview,/<h2[^>]*>(?:<span[^>]*>−<\/span>)?Cons<\/h2>/);
 assert.match(overview,/insider network/i);
 assert.doesNotMatch(overview,/What supports the case|What should give you pause|Why it might still run/);
 assert.doesNotMatch(overview,/Speculative demand can move thin markets/);
 assert.match(overview,/href="\/report\/saved-report\/summary#all-findings"/);
 assert.match(overview,/Project links, in one place/);
 const checks=renderView(report,"sources");
 assert.match(checks,/<h2>What remains unverified<\/h2>/);
 for(const gap of report.research.unknowns) assert.ok(checks.includes(gap),`Checks & gaps must retain: ${gap}`);
 assert.match(checks,/Token identity &amp; controls · Check 2/);
 assert.match(checks,/No usable result was received/);
 assert.match(renderView(report,"onchain"),/Warning · Possible linked insider network flagged/);
 assert.equal(JSON.stringify(report),before,"Moving visible coverage must not modify stored evidence");
});

test("mandatory on-chain data credit appears only when CoinGecko-family data was used",()=>{
 const report=fixture();
 let html=renderView(report,"overview");
 assert.match(html,/On-chain data · <a[^>]*href="https:\/\/www\.coingecko\.com\/en\/api"[^>]*>Powered by CoinGecko<\/a>/);
 assert.equal((html.match(/Powered by CoinGecko/g)||[]).length,1);
 report.research.market.corroboration=null;
 report.sources.push({name:"GeckoTerminal metadata",ok:false});
 assert.doesNotMatch(renderView(report,"overview"),/Powered by CoinGecko/);
 report.sources.at(-1).ok=true;
 assert.match(renderView(report,"overview"),/Powered by CoinGecko/);
 report.sources.at(-1).ok=false;
 report.research.market.provider="GeckoTerminal";
 assert.match(renderView(report,"overview"),/Powered by CoinGecko/);
});
