import {ExternalLink} from "lucide-react";
import {projectEvidence} from "@/lib/research/project-evidence.js";

type Item = Record<string,any>;
function Link({url,children}:{url:string;children:React.ReactNode}) {
 return <a className="inline-link external" href={url} target="_blank" rel="noopener noreferrer">{children}<ExternalLink size={13}/></a>;
}
export default function ProjectProfile({report}:{report:Item}) {
 const evidence=projectEvidence(report);
 return <section className="panel project-profile" aria-labelledby="project-profile-heading">
  <h2 id="project-profile-heading">Project, people &amp; public links</h2>
  {report.identity?.description && <div className="project-description"><span className="small muted">Token description</span><p>{report.identity.description}</p></div>}
  <h3>Website &amp; accounts</h3>
  {evidence.links.length ? <div className="project-link-grid">{evidence.links.map((link:Item)=><div className="project-link" key={link.url}><Link url={link.url}>{link.label}</Link><span className="small muted">{link.relationship}</span></div>)}</div> : <p className="small">No usable website or public account link was returned for this exact token.</p>}
  {evidence.facts.length>0 && <><h3>What the pages say</h3><dl className="project-facts">{evidence.facts.map((fact:Item,index:number)=><div key={index}><dt>{fact.label}</dt><dd>{fact.value} <Link url={fact.evidenceUrl}>View page</Link></dd></div>)}</dl><p className="small muted">Page-stated details, not independently tested product claims.</p></>}
  <h3>People publicly named</h3>
  {evidence.people.length ? <div className="project-people">{evidence.people.map((person:Item,index:number)=><div className="project-person" key={index}><strong>{person.name}</strong><span>{person.role} · page-stated role</span><div className="row"><Link url={person.url}>Public profile</Link><Link url={person.evidenceUrl}>Role evidence</Link></div></div>)}</div> : <p className="small">No named team member with an explicit project role and public profile was captured in this check.</p>}
  <p className="small muted">{evidence.pagesRead} public {evidence.pagesRead===1?"page":"pages"} read. Links and stated roles do not confirm ownership.</p>
  {evidence.legacy && <p className="small muted">This older report predates detailed page extraction. Refresh the check to look for additional links and page details.</p>}
 </section>;
}
