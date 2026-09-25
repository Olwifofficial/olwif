import test from "node:test";
import assert from "node:assert/strict";
import {evidenceUrl, projectEvidence} from "../lib/research/project-evidence.js";

const origin = "https://project.example/about";
const page = (overrides = {}) => ({
 url:origin,association:"reported-link",extractedLinks:[{kind:"x-profile",url:"https://x.com/exampleteam"},{kind:"docs",url:"https://docs.project.example/"}],
 facts:[{label:"Product",value:"Nearby payments over Bluetooth",kind:"page-stated",evidenceUrl:origin}],
 people:[{name:"Alex Example",role:"Co-founder",url:"https://x.com/alexexample",evidenceUrl:origin,context:"Our co-founder"}],...overrides
});
const fixture = (pages = [page()]) => ({generatedAt:"2026-09-24T08:00:00Z",identity:{name:"Example"},research:{
 links:[{kind:"website",url:"https://project.example/"},{kind:"social",url:"https://twitter.com/ExampleTeam"}],
 repositories:[{name:"example/app",url:"https://github.com/example/app"}],
 webResearch:{checkedAt:"2026-09-24T08:01:00Z",pages}
}});

test("legacy reported website and X links remain useful without fabricated team members", () => {
 const report = fixture([]); delete report.research.webResearch;
 const result = projectEvidence(report);
 assert.deepEqual(result.links.map(link=>link.label),["project.example","X · @ExampleTeam","GitHub · example/app"]);
 assert.equal(result.people.length,0); assert.equal(result.facts.length,0);
 assert.equal(result.pagesRead,0);
 assert.ok(result.links.every(link=>/Reported/.test(link.relationship)));
 assert.equal(result.checkedAt,report.generatedAt);
});

test("page-stated facts and explicit roles retain their matching original evidence URL", () => {
 const report = fixture(), before = structuredClone(report), result = projectEvidence(report);
 assert.equal(result.facts.length,1); assert.equal(result.people.length,1);
 assert.equal(result.facts[0].kind,"page-stated"); assert.equal(result.facts[0].evidenceUrl,origin);
 assert.equal(result.people[0].name,"Alex Example"); assert.equal(result.people[0].evidenceUrl,origin);
 assert.equal(result.people[0].relationship,"Role stated on checked page");
 assert.equal(result.links.find(link=>link.kind==="docs").evidenceUrl,origin);
 assert.equal(result.pagesRead,1); assert.equal(result.legacy,false);
 assert.deepEqual(report,before,"Display preparation must not change saved evidence");
});

test("unconfirmed search pages cannot populate project links, facts or team associations", () => {
 const report = fixture([page({association:"unconfirmed",kind:"search-result"})]);
 report.research.links=[]; report.research.repositories=[];
 const result=projectEvidence(report);
 assert.deepEqual(result.links,[]); assert.deepEqual(result.facts,[]); assert.deepEqual(result.people,[]);
 assert.equal(result.pagesRead,1,"A read page remains part of coverage even when its association is unconfirmed");
});

test("cross-origin or different-page evidence cannot be laundered into page-stated facts or people", () => {
 const report=fixture([page({
  facts:[{label:"Product",value:"Unsupported claim",kind:"page-stated",evidenceUrl:"https://elsewhere.example/about"},{label:"Product",value:"Different page",kind:"page-stated",evidenceUrl:"https://project.example/other"},{label:"Product",value:"Invented claim",kind:"inferred",evidenceUrl:origin}],
  people:[{name:"Unrelated Person",role:"Founder",url:"https://x.com/someone",evidenceUrl:"https://elsewhere.example/about"},{name:"Missing role",url:"https://x.com/someone",evidenceUrl:origin},{name:"Missing profile",role:"Founder",evidenceUrl:origin}]
 })]);
 const result=projectEvidence(report);
 assert.deepEqual(result.facts,[]); assert.deepEqual(result.people,[]);
});

test("evidence URLs reject executable, credential-bearing and local targets", () => {
 for(const raw of ["javascript:alert(1)","data:text/html,test","https://user:secret@public.example/","https://localhost/","https://127.0.0.1/","https://[::1]/","https://server.local/","https://127.0.0.1.nip.io/","https://host.example:8080/","https://public.example/?api_key=secret","https://public.example/?session=secret","https://public.example/\nattack","https://public.example\\attack"]){
  assert.equal(evidenceUrl(raw),null,raw);
 }
 assert.equal(evidenceUrl("https://public.example/about"),"https://public.example/about");
});

test("unsafe page origins and unsafe outgoing links do not become actionable evidence", () => {
 const report=fixture([page({url:"javascript:alert(1)"}),page({
  extractedLinks:[{kind:"website",url:"javascript:alert(1)"},{kind:"website",url:"https://user:pass@public.example/"}],
  facts:[],people:[{name:"Alex Example",role:"Founder",url:"javascript:alert(1)",evidenceUrl:origin}]
 })]);
 report.research.links=[{kind:"website",url:"data:text/html,test"}]; report.research.repositories=[];
 const result=projectEvidence(report);
 assert.deepEqual(result.links,[]); assert.deepEqual(result.facts,[]); assert.deepEqual(result.people,[]);
});

test("duplicate X and legacy Twitter handles collapse without treating posts or X controls as accounts", () => {
 const report=fixture([]);
 report.research.links=[
  {kind:"social",url:"https://twitter.com/ExampleTeam"},{kind:"social",url:"https://x.com/exampleteam/"},{kind:"social",url:"https://mobile.twitter.com/EXAMPLETEAM"},
  {kind:"social",url:"https://x.com/exampleteam/status/123"},{kind:"social",url:"https://x.com/intent"},{kind:"social",url:"https://x.com/home"},
  {kind:"social",url:"https://x.com/privacy"},{kind:"social",url:"https://x.com/logout"},{kind:"social",url:"https://x.com/notifications"}
 ]; report.research.repositories=[];
 const result=projectEvidence(report);
 assert.equal(result.links.length,1); assert.equal(result.links[0].label,"X · @ExampleTeam");
});

test("old web snapshots are identified for a fresh extraction and duplicates stay bounded", () => {
 const report=fixture([page(),page(),{url:"https://project.example/",association:"reported-link"}]);
 const result=projectEvidence(report);
 assert.equal(result.facts.length,1); assert.equal(result.people.length,1); assert.equal(result.legacy,true);
 assert.equal(result.links.filter(link=>link.label.startsWith("X ·")).length,1);
});

test("malformed saved array entries are ignored rather than crashing a report", () => {
 const report=fixture([null,42,"not a page",page({extractedLinks:[null,42,{kind:"docs",url:"https://docs.project.example/"}],facts:[null,42],people:[null,42]})]);
 report.research.links=[null,42,{kind:"website",url:"https://project.example/"}]; report.research.repositories=[null,42];
 const result=projectEvidence(report);
 assert.deepEqual(result.facts,[]); assert.deepEqual(result.people,[]);
 assert.ok(result.links.some(link=>link.url==="https://project.example/"));
});
