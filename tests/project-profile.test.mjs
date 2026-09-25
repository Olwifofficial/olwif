import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import ts from "typescript";
import {projectEvidence} from "../lib/research/project-evidence.js";

const require=createRequire(import.meta.url);
const source=readFileSync(new URL("../components/project-profile.tsx",import.meta.url),"utf8");
const {outputText}=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}});
const module={exports:{}};
new Function("require","module","exports",outputText)(name=>name==="@/lib/research/project-evidence.js"?{projectEvidence}:require(name),module,module.exports);
const render=report=>renderToStaticMarkup(React.createElement(module.exports.default,{report}));
const origin="https://project.example/about";
const fixture=()=>({identity:{description:"Claims to support nearby payments."},research:{
 links:[{kind:"website",url:"https://project.example/"},{kind:"social",url:"https://x.com/projectteam"}],
 webResearch:{pages:[{url:origin,association:"reported-link",extractedLinks:[],facts:[{label:"Product",value:"Nearby payments",kind:"page-stated",evidenceUrl:origin}],people:[{name:"Alex Example",role:"Co-founder",url:"https://x.com/alexexample",evidenceUrl:origin}]}]}
}});

test("project section renders website, X handle and concrete claims with separate role evidence",()=>{
 const report=fixture(),before=structuredClone(report),html=render(report);
 for(const text of ["Project, people &amp; public links","project.example","X · @projectteam","Nearby payments","Alex Example","Co-founder · page-stated role","Role evidence","Page-stated details, not independently tested product claims.","Links and stated roles do not confirm ownership."]) assert.ok(html.includes(text),text);
 for(const url of ["https://project.example/","https://x.com/projectteam","https://x.com/alexexample",origin]) assert.ok(html.includes(`href="${url}" target="_blank" rel="noopener noreferrer"`),url);
 assert.deepEqual(report,before);
 assert.doesNotMatch(html,/Free-only|No paid fallback|verified founder|authenticated team/i);
});

test("legacy reports retain useful profile links and invite a fresh extraction without inventing people",()=>{
 const report=fixture(); report.research.webResearch.pages=[{url:"https://project.example/",association:"reported-link"}];
 const html=render(report);
 assert.match(html,/X · @projectteam/);
 assert.match(html,/No named team member with an explicit project role and public profile was captured/);
 assert.match(html,/This older report predates detailed page extraction/);
 assert.doesNotMatch(html,/Alex Example|Co-founder|What the pages say/);
});

test("uncorrelated search pages are not turned into project biographies",()=>{
 const report=fixture(); report.research.webResearch.pages[0].association="unconfirmed";
 const html=render(report);
 assert.doesNotMatch(html,/Alex Example|Co-founder|What the pages say|Role evidence/);
 assert.match(html,/No named team member/);
 assert.match(html,/1 public page read/);
});

test("untrusted descriptions, claims, names and roles are escaped and executable links are dropped",()=>{
 const report=fixture(),attack='<img src=x onerror="alert(1)"><script>alert(2)</script>';
 report.identity.description=attack;
 const page=report.research.webResearch.pages[0];
 page.facts[0].value=attack; page.people[0].name=attack; page.people[0].role=attack;
 page.people.push({name:"Unsafe Profile",role:"Founder",url:"javascript:alert(1)",evidenceUrl:origin});
 report.research.links.push({kind:"website",url:"javascript:alert(1)"});
 const html=render(report);
 assert.match(html,/&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
 assert.match(html,/&lt;script&gt;alert\(2\)&lt;\/script&gt;/);
 assert.doesNotMatch(html,/<script|<img|href="javascript:|Unsafe Profile/);
});

test("a blank report clearly shows missing links and people instead of implying a clean project",()=>{
 const html=render({});
 assert.match(html,/No usable website or public account link was returned for this exact token/);
 assert.match(html,/No named team member/);
 assert.match(html,/0 public pages read/);
 assert.doesNotMatch(html,/safe project|No risk|verified team|All checks passed/i);
});
