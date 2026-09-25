import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {publicWebUrl, mentionsAddress, freePlanAllowsSearch, verifiedFreeAccountKey, collectPublicWeb} from "../lib/research/public-web.js";
import {createHash} from "node:crypto";
import {freeSearchWindows} from "../lib/research/free-search-budget.js";

const mint = "So11111111111111111111111111111111111111112";
const report = (links = [{url:"https://solana.com/",kind:"website",source:"Returned metadata"}]) => ({target:{chain:"solana",address:mint},research:{links},riskScore:20});
const json = (value, status=200, headers={}) => new Response(JSON.stringify(value),{status,headers:{"Content-Type":"application/json",...headers}});
const page = (url="https://solana.com/",content=`A public project page describing development. ${mint} Documentation at https://github.com/solana-labs/solana and https://x.com/solana.`,title="Project documentation") => ({code:200,data:{httpStatus:200,url,title,content}});
const usage = () => ({account:{current_plan:"Researcher",plan_usage:0,plan_limit:1000,paygo_usage:0,paygo_limit:0},key:{usage:0,limit:1000}});

test("complete self-description can use the reported project name without matching another project",async()=>{
 const r={...report(),identity:{name:"Example"}};
 const content="Unrelated is a payment service for all traders.\nExample turns nearby discovery into a payment experience. More untested promises follow here.";
 const web=await collectPublicWeb(r,{fetchImpl:async()=>json(page(undefined,content))});
 assert.equal(web.pages[0].facts[0].value,"Example turns nearby discovery into a payment experience.");
 assert.equal(web.pages[0].facts[0].kind,"page-stated");
 assert.equal(web.pages[0].excerpt,"");
 assert.doesNotMatch(JSON.stringify(web.pages[0].facts),/Unrelated/);
});

test("public reader URL gate rejects local, credentialed, recursive and functional query URLs",()=>{
 for(const url of ["http://solana.com","https://127.0.0.1/","https://2130706433/","https://[::1]/","https://user:key@solana.com/","https://localhost/","https://app.local/","https://127.0.0.1.nip.io/","https://r.jina.ai/https://solana.com","https://solana.com:8443/","https://project.org/docs?id=1","https://project.org/#/docs","https://project.org/?api_key=secret","https://metadata.google.internal/"]) assert.equal(publicWebUrl(url),null,url);
 assert.equal(publicWebUrl("https://solana.com/docs?utm_source=test&gclid=tracking#section"),"https://solana.com/docs");
});

test("exact-address matching is bounded and uses the correct chain case sensitivity",()=>{
 assert.equal(mentionsAddress(`(${mint})`,mint,"solana"),true);
 assert.equal(mentionsAddress(`x${mint}`,mint,"solana"),false);
 assert.equal(mentionsAddress(mint.toLowerCase(),mint,"solana"),false);
 const evm="0xABCDEF012345678901234567890123456789abcd";
 assert.equal(mentionsAddress(evm.toLowerCase(),evm,"base"),true);
 assert.equal(mentionsAddress(evm+"0",evm,"base"),false);
});

test("free search guard fails closed on billing, unknown plans, missing quotas and exhaustion",()=>{
 assert.equal(freePlanAllowsSearch(usage()),true);
 const free=usage();free.account.current_plan="Free";assert.equal(freePlanAllowsSearch(free),true);
 for(const change of [a=>a.account.current_plan="Bootstrap",a=>a.account.paygo_limit=10,a=>delete a.account.paygo_limit,a=>a.account.plan_usage=990,a=>a.account.plan_limit=1001,a=>a.key.usage=1000,a=>delete a.key.limit,a=>a.key.limit=0,a=>a.key.limit="1000",a=>a.account.paygo_usage=1]){const u=usage();change(u);assert.equal(freePlanAllowsSearch(u),false);}
 assert.equal(freePlanAllowsSearch(null),false);
});

test("nullable free account caps need a separate verification and retain all paid-use guards",()=>{
 const u=usage();u.key.limit=null;
 assert.equal(freePlanAllowsSearch(u),true,"Explicit null key cap is documented as unlimited");
 u.account.paygo_limit=null;
 assert.equal(freePlanAllowsSearch(u),false,"Null PAYG alone must not imply disabled billing");
 assert.equal(freePlanAllowsSearch(u,{verifiedFreeAccount:true}),true);
 assert.equal(freePlanAllowsSearch(u,{verifiedFreeAccount:"true"}),false);
 for(const change of [a=>delete a.account.paygo_limit,a=>a.account.paygo_limit=1,a=>a.account.paygo_usage=1,a=>a.account.current_plan="Bootstrap",a=>a.account.plan_usage=990,a=>a.account.plan_limit=4000,a=>delete a.key.limit,a=>a.key.limit=-1,a=>a.key.usage="0"]){const candidate=structuredClone(u);change(candidate);assert.equal(freePlanAllowsSearch(candidate,{verifiedFreeAccount:true}),false);}
});

test("free-account verification is bound to the exact private key",async()=>{
 const digest=createHash("sha256").update("test-private-key").digest("hex");
 assert.equal(await verifiedFreeAccountKey("test-private-key",digest),true);
 assert.equal(await verifiedFreeAccountKey("different-key",digest),false);
 assert.equal(await verifiedFreeAccountKey("test-private-key",undefined),false);
 assert.equal(await verifiedFreeAccountKey("test-private-key","confirmed"),false);
});

test("nullable-account search stays blocked for missing or mismatched key verification",async()=>{
 const digest=createHash("sha256").update("test-private-key").digest("hex");
 for(const fingerprint of [undefined,"0".repeat(64),digest]){
  const paths=[];
  const web=await collectPublicWeb(report([]),{tavilyKey:"test-private-key",freeOnlyKeySha256:fingerprint,reserveSearch:async()=>true,fetchImpl:async url=>{
   paths.push(url);const u=usage();u.account.paygo_limit=null;u.key.limit=null;
   return json(url.endsWith("/usage")?u:{results:[]});
  }});
  assert.equal(web.search.status,fingerprint===digest?"available":"limited");
  assert.equal(paths.length,fingerprint===digest?2:1);
  assert.equal(JSON.stringify(web).includes("test-private-key"),false);
  assert.equal(JSON.stringify(web).includes(digest),false);
 }
});

test("quota windows are UTC calendar based with hard free-only limits",()=>{
 const w=freeSearchWindows(Date.parse("2026-12-31T23:59:59Z"));
 assert.deepEqual(w.map(x=>[x.key,x.maximum]),[["free-web-day:2026-12-31",30],["free-web-month:2026-12",900]]);
 assert.equal(w[1].expires,Date.parse("2027-01-01T00:00:00Z"));
 assert.equal(freeSearchWindows(Date.parse("2028-02-14T00:00:00Z"))[1].expires,Date.parse("2028-03-01T00:00:00Z"));
});

test("key-free reading collects bounded notes without forwarding credentials or changing ratings",async()=>{
 const r=report(),before=JSON.stringify(r),calls=[];
 const web=await collectPublicWeb(r,{fetchImpl:async(url,init)=>{calls.push({url,init});return json(page());}});
 assert.equal(web.search.status,"not_configured");assert.equal(web.pages.length,1);assert.equal(web.pages[0].association,"exact-address");
 assert.match(web.pages[0].observations.join(" "),/GitHub link/);
 assert.equal(web.pages[0].publishedAt,null);
 assert.ok((web.pages[0].title+" "+web.pages[0].excerpt).split(/\s+/).length<=25);
 assert.equal(calls[0].url,"https://r.jina.ai/https://solana.com/");
 assert.equal(calls[0].init.headers.Authorization,undefined);assert.equal(calls[0].init.headers.Cookie,undefined);
 assert.equal(calls[0].init.headers["X-Robots-Txt"],"*");assert.equal(calls[0].init.credentials,"omit");assert.equal(calls[0].init.redirect,"manual");
 assert.equal(web.pages[0].content,undefined);assert.equal(JSON.stringify(r),before);
});

test("reader retains final validated page URL and does not call changed-host content verified",async()=>{
 const a=await collectPublicWeb(report(),{fetchImpl:async()=>json(page("https://www.solana.com/developers"))});
 assert.equal(a.pages[0].url,"https://www.solana.com/developers");assert.equal(a.checks[0].url,a.pages[0].url);
 const b=await collectPublicWeb(report(),{fetchImpl:async()=>json(page("https://unrelated.org/"))});
 assert.equal(b.pages.length,0);assert.equal(b.checks[0].ok,false);
});

test("short excerpts skip cookie banners and navigation rather than pretending to summarise them",async()=>{
 const content="This website uses cookies to improve your browsing experience. Please read our privacy policy.\n\nOur project builds open infrastructure for developers to create useful blockchain applications with public documentation.";
 const web=await collectPublicWeb(report(),{fetchImpl:async()=>json(page(undefined,content))});
 assert.match(web.pages[0].excerpt,/Our project builds/);assert.doesNotMatch(web.pages[0].excerpt,/cookies|privacy/i);
});

test("no matching address remains an unconfirmed reported link, never official",async()=>{
 const web=await collectPublicWeb(report(),{fetchImpl:async()=>json(page(undefined,"Welcome to the public website for a similarly named project. We claim useful things but do not show a matching address here."))});
 assert.equal(web.pages[0].addressMentioned,false);assert.equal(web.pages[0].association,"reported-link");
 assert.match(web.pages[0].observations[0],/not confirmed/);
});

test("public collection stops at four distinct attempts and respects owner pause",async()=>{
 const r=report(["a","a","b","c","d","e"].map(x=>({url:`https://project.org/${x}`,kind:"docs"})));let calls=0;
 const web=await collectPublicWeb(r,{fetchImpl:async url=>{calls++;return json(page(url.replace("https://r.jina.ai/","")));}});
 assert.equal(calls,4);assert.equal(web.pages.length,4);
 await collectPublicWeb(r,{disabledSources:["publicweb","websearch"],tavilyKey:"test",fetchImpl:()=>{throw new Error("must not request");}});
});

test("successful pages expose concrete safe social, repository, docs and product links",async()=>{
 const content=`Our public project offers open blockchain infrastructure with source links below. ${mint}
[Twitter](https://twitter.com/ProjectOwl)
[X](https://x.com/projectowl/)
[Telegram](https://t.me/projectowl)
[Discord](https://discord.com/invite/abc123)
[Code](https://github.com/project-owl/protocol.git)
[Code again](https://github.com/PROJECT-OWL/Protocol)
[Documentation](https://docs.project.org/guide)
[Launch app](https://app.project.org/)
[Team](/team)
[About](/about)
[Product](/product)`;
 const web=await collectPublicWeb(report([{url:"https://project.org/",kind:"social"}]),{fetchImpl:async()=>json(page("https://project.org/",content))});
 const links=web.pages[0].extractedLinks;
 assert.deepEqual(links.map(x=>x.kind),["x-profile","telegram","discord","github","docs","product","team","about","product"]);
 assert.equal(links.filter(x=>x.kind==="x-profile").length,1);
 assert.equal(links[0].url,"https://x.com/projectowl");assert.equal(links[0].label,"X profile");
 assert.equal(links.find(x=>x.kind==="github").url,"https://github.com/project-owl/protocol");
 assert.equal(links.find(x=>x.kind==="discord").url,"https://discord.gg/abc123");
 assert.ok(links.every(x=>x.relationship==="page-linked"));
 assert.deepEqual(web.pages[0].people,[]);assert.equal(web.pages[0].addressMentioned,true);
});

test("page extraction rejects X post/share links, lookalikes, auth and unsafe targets",async()=>{
 const content=`Our project page lists references for research, not instructions to execute. ${mint}
[X](https://x.com/alice/status/123)
[X](https://x.com/intent/tweet)
[X](https://x.com/search)
[X](https://x.com.evil.org/alice)
[Docs](http://project.org/docs)
[Docs](https://user:secret@project.org/docs)
[Docs](https://127.0.0.1/docs)
[Docs](https://project.local/docs)
[Docs](https://project.org/login/docs)
[Docs](https://project.org/%6cogin/docs)
[Docs](https://project.org/docs?api_key=secret)
[Docs](javascript:alert(1))
[Mail](mailto:person@example.com)
[Code](https://github.com/orgs/project)
<script>[X](https://x.com/hiddenprofile)</script>
[X](https://x.com/realprofile)`;
 const web=await collectPublicWeb(report(),{fetchImpl:async()=>json(page(undefined,content))});
 assert.deepEqual(web.pages[0].extractedLinks.map(x=>x.url),["https://x.com/realprofile"]);
 assert.doesNotMatch(JSON.stringify(web.pages[0]),/secret|<script|hiddenprofile|javascript:/);
});

test("extracted public links stay bounded even on link-heavy pages",async()=>{
 const content=`This public page has a large navigation collection with many outbound profile links and project claims. ${mint}\n`+Array.from({length:40},(_,i)=>`[Profile](https://x.com/project${i})`).join("\n");
 const web=await collectPublicWeb(report(),{fetchImpl:async()=>json(page(undefined,content))});
 assert.equal(web.pages[0].extractedLinks.length,16);
 assert.deepEqual(web.pages[0].people,[]);
});

test("only explicit named role statements produce page-stated people, within one quote budget",async()=>{
 const content=`This public project page includes descriptions and team declarations for independent review. ${mint}
[Jane Doe](https://x.com/janedoe) — Founder
CTO: [Alex Smith](https://x.com/alexsmith)
[Sam Guest](https://x.com/samguest)
Our supporters include [Other Person](https://x.com/otherperson), founder of another project.
Network: Solana
Status: Public beta
Launched: September 2026
Description: Open source blockchain analytics for project research`;
 const web=await collectPublicWeb(report(),{fetchImpl:async()=>json(page(undefined,content,"A rather long public project title with many extra words"))});
 const p=web.pages[0];
 assert.deepEqual(p.people.map(x=>[x.name,x.role]),[["Jane Doe","Founder"],["Alex Smith","CTO"]]);
 assert.ok(p.people.every(x=>x.evidenceUrl===p.url));
 assert.ok(p.facts.some(x=>x.label==="Network stated by page"&&x.value==="Solana"));
 assert.ok(p.facts.every(x=>x.kind==="page-stated"&&x.evidenceUrl===p.url));
 assert.equal(p.excerpt,"");
 const copied=[p.title,p.excerpt,...p.people.flatMap(x=>[x.name,x.role,x.context]),...p.facts.map(x=>x.value)].filter(Boolean).join(" ");
 assert.ok(copied.split(/\s+/).length<=25,copied);
 assert.equal(p.people.some(x=>x.name==="Sam Guest"||x.name==="Other Person"),false);
});

test("claims and social links remain page-stated when mint association is not established",async()=>{
 const content="This page has a similarly named project but no matching contract address.\nNetwork: Solana\nStatus: Not yet launched\n[X](https://x.com/projectowl)\n[Jane Doe](https://x.com/janedoe) — Founder";
 const web=await collectPublicWeb(report(),{fetchImpl:async()=>json(page(undefined,content))});
 const p=web.pages[0];assert.equal(p.addressMentioned,false);assert.equal(p.association,"reported-link");
 assert.equal(p.people.length,1);assert.ok(p.facts.some(x=>x.value==="Not yet launched"));
 assert.ok(p.extractedLinks.every(x=>x.relationship==="page-linked"));
 assert.match(p.observations[0],/not confirmed/);
 assert.doesNotMatch(JSON.stringify(p),/"verified":true|"relationship":"official"/);
});

test("short complete self-descriptions are captured without truncating longer claims",async()=>{
 const content="We build open-source analytics for Solana developers.\nThis source page describes its own product; these claims are not independently authenticated.";
 const web=await collectPublicWeb(report(),{fetchImpl:async()=>json(page(undefined,content))});
 assert.deepEqual(web.pages[0].facts,[{label:"Project description",value:"We build open-source analytics for Solana developers.",evidenceUrl:"https://solana.com/",kind:"page-stated"}]);
 assert.equal(web.pages[0].excerpt,"");
 const long="We build an analytics project which will only become available if our funding target and extensive independent technical reviews are successfully completed.";
 const other=await collectPublicWeb(report(),{fetchImpl:async()=>json(page(undefined,long))});
 assert.deepEqual(other.pages[0].facts,[]);
});

test("one observed-link follow-up wave keeps partial successes and never crawls recursively",async()=>{
 const calls=[];
 const homepage=`Project documentation and the team are described at the following public pages. ${mint}\n[Team](/team)\n[Docs](/docs)\n[About](/about)`;
 const web=await collectPublicWeb(report([{url:"https://project.org/",kind:"website"},{url:"https://x.com/projectowl",kind:"social"}]),{fetchImpl:async url=>{
  const source=url.replace("https://r.jina.ai/","");calls.push(source);
  if(source.startsWith("https://x.com"))return json({},403);
  return json(page(source,source==="https://project.org/"?homepage:`The project publishes public documentation for independent review of its declared claims.\n[More team](/team/deeper)\nNetwork: Solana`));
 }});
 assert.deepEqual(calls,["https://project.org/","https://x.com/projectowl","https://project.org/team","https://project.org/about"]);
 assert.equal(web.checks.length,4);assert.equal(web.pages.length,3);
 assert.equal(web.checks[1].ok,false);assert.equal(calls.some(x=>x.endsWith("deeper")),false);
});

test("aborted follow-up preserves successful evidence and bounds simultaneous reader requests",async()=>{
 const controller=new AbortController();let active=0,peak=0;
 const web=await collectPublicWeb(report([{url:"https://project.org/",kind:"website"}]),{signal:controller.signal,fetchImpl:async url=>{
  active++;peak=Math.max(peak,active);
  const source=url.replace("https://r.jina.ai/","");
  if(source!=="https://project.org/"){controller.abort();active--;throw new DOMException("Timeout","AbortError");}
  active--;return json(page(source,`A public project page explains the product and gives more information at these links. ${mint}\n[Team](/team)\n[Docs](/docs)`));
 }});
 assert.equal(web.pages.length,1);assert.ok(web.checks.some(x=>!x.ok));assert.ok(peak<=2);
});

test("free search uses one basic exact-address discovery request and never AI answers",async()=>{
 let reserved=0;const calls=[];
 const web=await collectPublicWeb(report([]),{tavilyKey:"test-key",reserveSearch:async()=>{reserved++;return true;},fetchImpl:async(url,init)=>{
  calls.push({url,init});
  if(url.endsWith("/usage"))return json(usage());
  if(url.endsWith("/search"))return json({results:[{url:"https://project.org/docs",title:"Project",content:`This is ${mint}`},{url:"https://wrong.org/",title:"Same project name",content:"Not the same token"}]});
  return json(page("https://project.org/docs"));
 }});
 assert.equal(reserved,1);assert.equal(web.search.status,"available");assert.equal(web.pages.length,1);
 const body=JSON.parse(calls.find(c=>c.url.endsWith("/search")).init.body);
 assert.deepEqual(body,{query:`"${mint}"`,search_depth:"basic",topic:"general",max_results:5,auto_parameters:false,include_answer:false,include_raw_content:false,include_images:false,include_usage:true});
 assert.equal(calls[2].init.headers.Authorization,undefined);
 assert.equal(web.pages[0].discoveredVia,"Tavily exact-address search");
 assert.equal(JSON.stringify(web).includes("test-key"),false);
});

test("paid-plan or site-quota failures never reach search and never retry",async()=>{
 for(const kind of ["paid","exhausted","unavailable"]){const paths=[];const web=await collectPublicWeb(report([]),{tavilyKey:"test",reserveSearch:kind==="unavailable"?undefined:async()=>false,fetchImpl:async url=>{paths.push(url);const u=usage();if(kind==="paid")u.account.paygo_limit=1;return json(u);}});assert.equal(web.search.status,"limited");assert.deepEqual(paths,["https://api.tavily.com/usage"]);}
});

test("rate limits and permission failures stay explicit, without paid fallback",async()=>{
 for(const status of [402,403,429,432]){let calls=0;const web=await collectPublicWeb(report(),{fetchImpl:async()=>{calls++;return json({},status);}});assert.equal(calls,1);assert.equal(web.pages.length,0);assert.equal(web.checks[0].ok,false);assert.match(web.checks[0].message,/No paid fallback|No restriction/);}
});

test("oversized, malformed, blocked and nonmatching responses do not become evidence",async()=>{
 for(const response of [()=>json(page(),200,{"Content-Length":"900000"}),()=>json({code:200,data:{...page().data,httpStatus:403}}),()=>json(page(undefined,undefined,"Access denied")),()=>new Response("not json")]){
  const web=await collectPublicWeb(report(),{fetchImpl:async()=>response()});assert.equal(web.pages.length,0);assert.equal(web.checks[0].ok,false);
 }
});

test("cancellation stops the public research request",async()=>{
 const controller=new AbortController();controller.abort();let calls=0;
 await assert.rejects(collectPublicWeb(report(),{signal:controller.signal,fetchImpl:()=>{calls++;}}));assert.equal(calls,0);
});

test("report pipeline enables free enrichment automatically without changing source scoring",()=>{
 const source=readFileSync(new URL("../app/api/research/route.ts",import.meta.url),"utf8");
 assert.match(source,/collectPublicWeb\(report/);assert.match(source,/TAVILY_API_KEY/);assert.match(source,/reserveSearch:reserveFreeSearch/);
 assert.doesNotMatch(source,/BRAVE_SEARCH_API_KEY|OPENAI_API_KEY|GEMINI_API_KEY/);
});
