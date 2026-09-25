import {ExternalLink} from "lucide-react";
import {safeLink} from "@/lib/security";
import {displayLinkLabel} from "@/lib/research/link-label.js";

type Item = Record<string, any>;
function date(value: unknown) {
 const timestamp = typeof value === "number" ? value : Date.parse(String(value));
 return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().replace("T", " ").slice(0, 19) + " UTC" : "Not supplied";
}
function number(value: unknown) {
 return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("en-GB", {maximumFractionDigits:2}) : "Not verified";
}
const GAP_COPY: Record<string, string> = {
 MINT_UNREADABLE: "The mint account could not be read. Token identity and any missing controls remain unverified.",
 RUGCHECK_UNAVAILABLE: "The token-security check did not return usable results. This part remains unverified.",
 TOKEN_LOOKUP_UNAVAILABLE: "The token identity check did not return usable results. The exact token could not be confirmed by this check.",
 CONTRACT_DETAILS_UNAVAILABLE: "Contract details could not be read. Source verification and administrative controls remain unverified.",
 HOLDER_DISTRIBUTION_UNKNOWN: "A usable holder-balance snapshot was not received. Concentration and wallet ownership remain unverified.",
 SELL_SIMULATION_UNAVAILABLE: "The sellability check did not return usable results. Selling ability is not confirmed.",
};
// Only known operational-failure fields are replaced. Never redact a provider
// word globally: it may be part of a project's actual name or quoted claim.
export function plainCheckFinding(finding: Item) {
 return Object.hasOwn(GAP_COPY,finding?.code) ? {...finding, detail:GAP_COPY[finding.code]} : finding;
}
export function plainCheckGaps(report: Item): string[] {
 const rewrites = new Map<string, string>();
 for (const finding of report.findings || []) {
  if (!Object.hasOwn(GAP_COPY,finding.code)) continue;
  rewrites.set(`${finding.title}: ${finding.detail || "Not verified."}`, `${finding.title}: ${GAP_COPY[finding.code]}`);
 }
 return (report.research?.unknowns || []).map((text: string) => rewrites.get(text) || text);
}
function checkLabel(name: unknown, index: number) {
 const names: Record<string,string> = {
  "Solana mint":"Token identity & controls", "Solana holders":"Holder balances", "Blockscout holders":"Holder balances",
  RugCheck:"Token security", "GoPlus security":"Token security", "DEX market":"Market snapshot", "GeckoTerminal market":"Market snapshot",
  "GeckoTerminal metadata":"Project metadata", "Blockscout token":"Token identity", "Verified contract":"Contract source",
  "Contract address":"Deployment record", "Creator history":"Creator history", "GitHub repository":"Code repository",
 };
 return typeof name === "string" && Object.hasOwn(names,name) ? names[name] : `Additional check ${index + 1}`;
}
function checkState(check: Item) {
 if (check.ok === true || check.status === "available") return {label:"Data returned",detail:check.snapshot ? "A recorded snapshot was received. Its underlying age may be unknown." : "A matching response was received. A completed check is not a safety guarantee.",ok:true};
 if (check.status === "paused" || check.error === "This source is paused by the site owner.") return {label:"Paused",detail:"This check was paused. No conclusion was made for this part.",ok:false};
 if (check.status === "not_configured" || check.error === "This source is not configured for this chain. Explorer links are provided for manual review." || check.error === "No public creator-history provider is configured for this chain.") return {label:"Not checked",detail:"This check was not available for this report. This part remains unverified.",ok:false};
 if (check.status === "limited") return {label:"Incomplete",detail:"This check did not complete. Missing results remain unverified.",ok:false};
 return {label:"Not verified",detail:"No usable result was received. This part remains unverified.",ok:false};
}
function webAssociation(value: unknown) {
 return value === "exact-address" ? "Exact address found in page text; ownership not verified" : value === "reported-link" ? "Reported project link; ownership not verified" : "Association not confirmed";
}
function SourceLink({url, children}: {url: unknown, children: React.ReactNode}) {
 const href = safeLink(url);
 return href ? <a className="inline-link external" href={href} target="_blank" rel="noopener noreferrer">{children}<ExternalLink size={13}/></a> : <span>{children}</span>;
}
function Evidence({label, children}: {label: string, children: React.ReactNode}) {
 return <div className="source-row"><div><strong>{label}</strong>{children}</div></div>;
}
function Check({check, label, url}: {check: Item, label: string, url?: unknown}) {
 const state = checkState(check);
 return <div className="source-row">
  <div><strong>{label}</strong><p className="small muted">Checked: {date(check.checkedAt)} · Data updated: {date(check.upstreamUpdatedAt)}</p><p className="small">{state.detail}</p></div>
  <div className="source-state"><span className={"tag " + (state.ok ? "returned" : "unverified")}>{state.label}</span>{Boolean(url) && <SourceLink url={url}>Inspect evidence</SourceLink>}</div>
 </div>;
}

// A display-only view. Provider metadata, operational messages and original
// wording remain untouched in storage and in Save report, not narrated here.
export default function ReportSources({report}: {report: Item}) {
 const research = report.research || {}, metrics = report.metrics || {};
 const sources: Item[] = report.sources || [], links: Item[] = research.links || [];
 const observations: Item[] = metrics.holderCountObservations || [];
 const gaps = plainCheckGaps(report);
 const hasHolderConflict = new Set(observations.map(item => item.count).filter(value => typeof value === "number")).size > 1;
 return <>
  <section className="panel">
   <h2>Checks at a glance</h2>
   <p>See what was checked, when the information was collected and what still needs verifying. A returned warning is not proof of fraud; a completed check is not proof of safety.</p>
   <p className="small muted">This is a dated snapshot, not continuous monitoring. Data age can differ from the time a check was made. Related checks may use the same underlying information.</p>
   <div className="stack">{sources.map((check: Item, index: number) => <Check key={index} check={check} label={`${checkLabel(check.name,index)} · Check ${index + 1}`} url={check.url}/>)}</div>
   {!sources.length && <p className="notice">No check records were saved. Coverage remains unverified.</p>}
   <p className="small"><a className="inline-link" href="/terms#research-providers">About our research providers</a></p>
  </section>
  <section className="panel">
   <h2>Evidence behind the report</h2>
   <div className="stack">
    <Evidence label="Reported creator / deployer"><p className="small mono">{research.creator?.address ? <SourceLink url={research.creator.url}>{research.creator.address}</SourceLink> : "Not verified"}</p><p className="small muted">A wallet address is not a verified person.</p></Evidence>
    <Evidence label="Displayed holder total"><p className="small">{number(metrics.holders)} · Data updated: {date(metrics.holdersUpdatedAt)}</p><p className="small muted">{hasHolderConflict ? "Holder counts disagree. The snapshots below may differ in age or counting method; unresolved conflicts remain unverified." : "Counts are snapshots, not a verified number of individual people."}</p></Evidence>
    <Evidence label="Market figures"><p className="small">{research.market?.poolUrl ? <SourceLink url={research.market.poolUrl}>Inspect selected pool</SourceLink> : "Not verified"}</p>{research.market?.corroboration && <p className="small"><SourceLink url={research.market.corroboration.url}>Inspect comparison pool</SourceLink></p>}</Evidence>
    {(research.repositories || []).map((repository: Item) => <Evidence key={repository.url} label={`Repository: ${repository.name}`}><p className="small"><SourceLink url={repository.url}>Inspect repository</SourceLink> · Project ownership and code quality are not verified.</p></Evidence>)}
   </div>
   {observations.length > 0 && <>
    <h3>Holder-count snapshots</h3>
    <div className="table-scroll"><table><thead><tr><th>Snapshot</th><th>Count</th><th>Collected</th><th>Data updated</th></tr></thead><tbody>
     {observations.map((observation: Item, index: number) => <tr key={index}><td>Snapshot {index + 1}</td><td>{number(observation.count)}</td><td>{date(observation.fetchedAt)}</td><td>{date(observation.upstreamUpdatedAt)}</td></tr>)}
    </tbody></table></div>
   </>}
   {(metrics.topHolders || []).length > 0 && <details><summary>Holder balances</summary>
    <div className="table-scroll"><table><thead><tr><th>Address</th><th>Share</th><th>Account type</th></tr></thead><tbody>
     {metrics.topHolders.map((holder: Item, index: number) => <tr key={index}><td><SourceLink url={holder.url}><span className="mono">{holder.address}</span></SourceLink></td><td>{typeof holder.percentage === "number" && Number.isFinite(holder.percentage) ? `${number(holder.percentage)}%` : "Not verified"}</td><td>{holder.kind || "Not verified"}</td></tr>)}
    </tbody></table></div>
   </details>}
  </section>
  {research.buyerActivity && <section className="panel">
   <h2>Buyer-behaviour evidence</h2>
   <Check label="Selected-pool wallet trade sample" check={research.buyerActivity} url={research.buyerActivity.sourceUrl}/>
   <p className="small">Source: GeckoTerminal public pool trades. Up to 300 recent trades within the previous 24 hours; this is not a full wallet history or a count of individual people.</p>
   <p className="small muted">Only the selected pool with an exact base-token and network match is used. Repeated buying and lower-price purchases describe the returned sample, not verified intent, total holdings or lifetime cost basis. This extra sample does not change the token’s safety rating.</p>
  </section>}
  {links.length > 0 && <section className="panel">
   <h2>Related evidence &amp; project links</h2>
   <p className="small muted">Listed links are not independently authenticated as official. Match the exact token address on each destination.</p>
   <div className="link-grid">{links.map((link: Item) => <div className="link-item" key={link.url}><span className="tag">{link.kind}</span><SourceLink url={link.url}>{link.kind === "risk" ? "Security report" : link.kind === "market" ? "Market chart" : link.kind === "explorer" ? "Token explorer" : displayLinkLabel(link,"Project link")}</SourceLink></div>)}</div>
  </section>}
  {research.webResearch && <section className="panel" id="public-web-sources">
   <h2>Public-page checks</h2>
   <p className="small muted">Limited page reading and exact-address discovery. These checks do not change the safety assessment or authenticate a project.</p>
   <Check label="Exact-address discovery" check={{...research.webResearch.search,checkedAt:research.webResearch.search?.checkedAt || research.webResearch.checkedAt}}/>
   {!(research.webResearch.checks || []).length && <p className="notice">{(research.webResearch.summary || []).includes("Public-page reading is paused by the owner.") ? "Public-page reading is paused. No page-content conclusions were made." : "No public-page check results were recorded. Page content remains unverified."}</p>}
   {(research.webResearch.checks || []).map((check: Item, index: number) => <Check key={index} check={check} label={`Public page ${index + 1}`} url={check.url}/>)}
   {(research.webResearch.pages || []).map((page: Item, index: number) => <Evidence key={index} label={`Page notes ${index + 1}`}><p className="small"><SourceLink url={page.url}>{page.title || "Original page"}</SourceLink> · {webAssociation(page.association)}</p></Evidence>)}
  </section>}
  <section className="panel"><h2>What remains unverified</h2>
   {gaps.length ? <ul className="evidence-list">{gaps.map((gap: string, index: number) => <li key={index}>{gap}</li>)}</ul> : <p className="muted">No additional gaps were recorded. This does not establish completeness or safety.</p>}
   <p>{research.webResearch ? "Public-page notes are limited text checks, not authentication of claims, social audiences or complete creator histories. Search and page-reading coverage are recorded separately above." : "Web search, social-post analysis, website content review and complete creator histories are not automatically verified by the checks above."}</p>
  </section>
 </>;
}
