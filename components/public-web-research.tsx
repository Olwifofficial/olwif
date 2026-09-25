import {ExternalLink} from "lucide-react";
import {safeLink} from "@/lib/security";

type Item = Record<string, unknown>;
const item = (value: unknown): Item => value && typeof value === "object" && !Array.isArray(value) ? value as Item : {};
const words = (value: unknown): string[] => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim())) : [];
// Presentation-only handling for an older OLWIF-generated timeout note. Keep
// stored evidence and third-party titles/excerpts unchanged.
const coverageNote = (value: string) => value === "No conclusions about page content or social activity were made. No paid fallback was used."
 ? "No conclusions about page content or social activity were made." : value;
const text = (value: unknown, fallback: string) => typeof value === "string" && value.trim() ? value : fallback;
function date(value: unknown) {
 const timestamp = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Date.parse(value) : NaN;
 return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().replace("T", " ").slice(0, 19) + " UTC" : "Not supplied";
}
function searchStatus(value: unknown) {
 switch (value) {
  case "available": return "A limited web search returned results. Results do not establish project ownership.";
  case "limited": return "Web search could not be completed for this check. Other returned page checks are shown below.";
  case "error": return "Web search did not return usable results for this check.";
  case "paused": return "Web search is paused. Other returned page checks are shown below.";
  default: return "Wider web search was not available for this check. Public-page checks can still use links found for this token.";
 }
}
function association(page: Item) {
 if (page.association === "exact-address" && page.addressMentioned === true) return "The exact token address appears in the returned text. This alone does not prove ownership or authenticity.";
 if (page.association === "reported-link") return "Linked in the token’s returned metadata; ownership is not independently verified.";
 return "Association with this exact token is not confirmed.";
}

// Research text is untrusted: render it as text only, never HTML or Markdown.
// Page retrieval is not an endorsement and must not change the token’s score.
export default function PublicWebResearch({report}: {report: Item}) {
 const raw = item(report.research).webResearch;
 const research = item(raw);
 if (!raw || research.version !== 1) return <section className="panel" aria-labelledby="public-web-heading">
  <h2 id="public-web-heading">Public web research</h2>
  <p className="small muted">This saved report predates public-page checks. Refresh check to include them.</p>
 </section>;

 const pages = Array.isArray(research.pages) ? research.pages.filter(page => page && typeof page === "object" && !Array.isArray(page)).map(item) : [];
 const summary = words(research.summary).map(coverageNote), limitations = words(research.limitations).map(coverageNote);
 return <section className="panel" aria-labelledby="public-web-heading">
  <h2 id="public-web-heading">Public web research</h2>
  <p className="small muted">Checked: {date(research.checkedAt)} · {pages.length ? "Partial coverage" : "No page content collected"}</p>
  {summary.length > 0 && <ul className="evidence-list">{summary.map((note, index) => <li key={index}>{note}</li>)}</ul>}
  <p className="small">{searchStatus(item(research.search).status)}</p>
  {!pages.length && <p>We could not collect readable public-page content for this check. That is a gap in the evidence, not a positive or negative verdict about the project.</p>}

  <div className="stack">{pages.map((page, index) => {
   const href = safeLink(page.url), observations = words(page.observations);
   const excerpt = text(page.excerpt, "").slice(0, 400);
   return <article className="finding" key={text(page.id, `page-${index}`)}>
    <strong>{text(page.title, `Public page ${index + 1}`)}</strong>
    <p className="small">{association(page)}</p>
    {observations.length > 0 && <ul className="evidence-list">{observations.map((note, noteIndex) => <li key={noteIndex}>{note}</li>)}</ul>}
    {excerpt && <details><summary>Page excerpt, not a verified claim</summary><blockquote><p className="small">“{excerpt}{typeof page.excerpt === "string" && page.excerpt.length > 400 ? "…" : ""}”</p></blockquote></details>}
    <p className="small muted">Page checked: {date(page.checkedAt)} · Publication date: {date(page.publishedAt)}</p>
    {href ? <a className="inline-link external small" href={href} target="_blank" rel="noopener noreferrer">View page<span className="sr-only">: {text(page.title, "public page")} (opens in a new tab)</span><ExternalLink size={13}/></a> : <span className="small muted">Page link not available</span>}
   </article>;
  })}</div>

  <h3>What this does not establish</h3>
  {limitations.length > 0 && <ul className="evidence-list">{limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul>}
  <p className="small muted">Public pages can contain promotional, stale or misleading claims. These checks do not verify team identities, social activity, project promises or safety. Coverage details are in Checks &amp; gaps.</p>
 </section>;
}
