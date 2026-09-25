import type {ReactNode} from "react";
import {ExternalLink} from "lucide-react";
import {safeLink} from "@/lib/security";
import {tokenSupply, taxPercent} from "@/lib/format";
import {presentResearchReport} from "@/lib/research/report-presentation.js";
import {displayLinkLabel} from "@/lib/research/link-label.js";
import ReportVerdict from "@/components/report-verdict";
import ReportSources, {plainCheckFinding} from "@/components/report-sources";
import ProjectProfile from "@/components/project-profile";
import PublicWebResearch from "@/components/public-web-research";
import ProsCons from "@/components/pros-cons";
import {marketSnapshot} from "@/lib/research/market-snapshot.js";
import BuyerBehaviour from "@/components/buyer-behaviour";
import TradingActivity from "@/components/trading-activity";

type Item = Record<string, any>;
const object = (value: unknown): Item => value && typeof value === "object" && !Array.isArray(value) ? value as Item : {};
const rows = (value: unknown): Item[] => Array.isArray(value) ? value.filter(item => item && typeof item === "object" && !Array.isArray(item)) : [];
const text = (value: unknown, fallback = "Not verified") => typeof value === "string" && value.trim() ? value : fallback;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function detailDate(value: unknown) {
 const timestamp = finite(value) ? value : typeof value === "string" && value.trim() ? Date.parse(value) : NaN;
 return Number.isFinite(timestamp) && Math.abs(timestamp) <= 8.64e15 ? new Date(timestamp).toISOString().replace("T", " ").slice(0, 19) + " UTC" : "Not verified";
}
export function detailNumber(value: unknown, suffix = "") {
 return finite(value) ? value.toLocaleString("en-GB", {maximumFractionDigits:2}) + suffix : "Not verified";
}
export function detailMoney(value: unknown) {
 return finite(value) ? new Intl.NumberFormat("en-GB", {style:"currency", currency:"USD", maximumFractionDigits:value !== 0 && Math.abs(value) < .01 ? 8 : 2}).format(value) : "Not verified";
}
export function DetailLink({url, children}: {url:unknown; children:ReactNode}) {
 const href = safeLink(url);
 return href ? <a className="inline-link external" href={href} target="_blank" rel="noopener noreferrer">{children}<ExternalLink size={13}/></a> : <span>{children}</span>;
}
export function DetailFact({label, value}: {label:string; value:ReactNode}) {
 return <div className="fact"><dt>{label}</dt><dd>{value ?? "Not verified"}</dd></div>;
}
function authority(status:unknown,address:unknown) {
 const reportedStatus=text(status,""), reportedAddress=text(address,"");
 return reportedStatus&&reportedAddress?`${reportedStatus} · ${reportedAddress}`:reportedStatus||reportedAddress||"Not verified";
}
export function DetailFindings({findings, title = "Detailed findings"}: {findings:Item[]; title?:string}) {
 return <section className="panel"><h2>{title}</h2>{findings.length ? <div className="stack">{findings.map(plainCheckFinding).map((finding, index) => {
  const limited = finding.code === "RUGCHECK_NO_LISTED_RISKS" && !finding.hardFail;
  const severity = limited ? "info" : ["danger", "warn", "good", "unknown", "info"].includes(finding.severity) ? finding.severity : "unknown";
  const label = finding.hardFail ? "Critical warning" : limited ? "Limited check" : severity === "good" ? "Check passed" : severity === "unknown" ? "Not verified" : severity === "info" ? "Context" : "Warning";
  return <article className={`finding ${severity}`} key={index}><strong>{label} · {text(finding.title, "Recorded finding")}</strong><p>{text(finding.detail, "No further detail was saved.")}</p><span className="small muted">{text(finding.category, "Other evidence")}</span></article>;
 })}</div> : <p className="small muted">No detailed findings were recorded for this section. That does not establish that the checks were complete or clear.</p>}</section>;
}
function oldestFirst(items:Item[], key:string) {
 const time = (item:Item) => { const value=item[key]; const n=finite(value)?value:typeof value==="string"?Date.parse(value):NaN; return Number.isFinite(n)?n:Infinity; };
 return [...items].sort((a,b) => time(a)-time(b));
}
export function CreatorDetails({research, metrics}: {research:Item; metrics:Item}) {
 const creator = object(research.creator), previous = oldestFirst(rows(creator.previousContracts), "timestamp");
 return <section className="panel"><h2>Creator &amp; deployment history</h2><dl className="facts">
  <DetailFact label="Reported creator / deployer" value={creator.address ? <DetailLink url={creator.url}><span className="mono">{text(creator.address)}</span></DetailLink> : "Not verified"}/>
  <DetailFact label="Recent outgoing transactions checked" value={detailNumber(creator.recentTransactions)}/>
  <DetailFact label="Contract creations in returned history" value={detailNumber(creator.recentContractCreations)}/>
  <DetailFact label="Developer holdings reported" value={detailNumber(metrics.developerHoldingsPct, "%")}/>
 </dl>{typeof creator.historyCoverage==="string"&&creator.historyCoverage.trim()&&<p className="small">{creator.historyCoverage}</p>}<p className="small muted">A wallet is not a verified person. This is a limited history window; a contract creation is not automatically a token launch or a rug pull.</p>
 {previous.length > 0 && <><h3>Returned contract creations · oldest first</h3><div className="table-scroll"><table><thead><tr><th scope="col">Created</th><th scope="col">Contract</th></tr></thead><tbody>{previous.map((entry,index) => <tr key={index}><td>{detailDate(entry.timestamp)}</td><td><DetailLink url={entry.url}><span className="mono">{text(entry.address)}</span></DetailLink></td></tr>)}</tbody></table></div></>}
 {!previous.length && <p className="small">No prior contract addresses were saved in this check. This does not prove there are no earlier launches.</p>}
 </section>;
}
export function HolderDetails({metrics}: {metrics:Item}) {
 const holders = rows(metrics.topHolders), raw = rows(metrics.rawTopHolders), displayed = holders.length ? holders : raw;
 const snapshots = rows(metrics.holderCountObservations), conflicting = new Set(snapshots.map(item=>item.count).filter(finite)).size > 1;
 return <section className="panel"><h2>Holders &amp; concentration</h2><dl className="facts">
  <DetailFact label="Holder count" value={detailNumber(metrics.holders)}/>
  <DetailFact label="Largest exposed holder" value={detailNumber(metrics.topHolderPct, "%")}/>
  <DetailFact label="Exposed top 10 combined" value={detailNumber(metrics.top10Pct, "%")}/>
  <DetailFact label="Developer holdings reported" value={detailNumber(metrics.developerHoldingsPct, "%")}/>
  <DetailFact label="Possible insider holdings reported" value={detailNumber(metrics.insiderPercentage, "%")}/>
  <DetailFact label="Holder data updated" value={detailDate(metrics.holdersUpdatedAt)}/>
 </dl>
 {conflicting && <p className="notice">Returned holder counts disagree. They may reflect different collection times or counting methods; the total remains unresolved.</p>}
 {displayed.length ? <div className="table-scroll"><table><thead><tr><th scope="col">Address</th><th scope="col">Share</th><th scope="col">Account type</th></tr></thead><tbody>{displayed.map((holder,index)=><tr key={index}><td><DetailLink url={holder.url}><span className="mono">{text(holder.address)}</span></DetailLink></td><td>{detailNumber(holder.percentage,"%")}</td><td>{text(holder.kind)}</td></tr>)}</tbody></table></div> : <p className="small">No usable holder-address table was saved.</p>}
 <p className="small muted">Balances can include pools, vaults and contracts. Separate addresses do not prove separate owners; linked wallets, bundles and snipers are not fully mapped.</p>
 </section>;
}
export function MarketWindows({windows}: {windows:unknown}) {
 const entries = rows(windows);
 return entries.length ? <div className="table-scroll"><table><caption className="sr-only">Recorded market activity by time window</caption><thead><tr><th scope="col">Window</th><th scope="col">Volume</th><th scope="col">Buys</th><th scope="col">Sells</th><th scope="col">Transactions</th><th scope="col">Price change</th></tr></thead><tbody>{entries.map((entry,index)=><tr key={index}><th scope="row">{text(entry.window)}</th><td>{detailMoney(entry.volumeUsd)}</td><td>{detailNumber(entry.buys)}</td><td>{detailNumber(entry.sells)}</td><td>{detailNumber(entry.transactions)}</td><td>{detailNumber(entry.priceChangePct,"%")}</td></tr>)}</tbody></table></div> : <p className="small">No time-window activity was saved for this report.</p>;
}
function RepositoryDetails({research}: {research:Item}) {
 const repositories = oldestFirst(rows(research.repositories), "createdAt");
 return <section className="panel"><h2>Code &amp; development</h2>{repositories.length ? repositories.map((repo,index)=><article className="repo" key={index}><h3><DetailLink url={repo.url}>{text(repo.name,"Reported repository")}</DetailLink></h3>{typeof repo.description==="string"&&repo.description&&<p>{repo.description}</p>}<dl className="facts">
  <DetailFact label="Repository created" value={detailDate(repo.createdAt)}/><DetailFact label="Last code push" value={detailDate(repo.pushedAt)}/>
  <DetailFact label="Archived" value={typeof repo.archived==="boolean"?repo.archived?"Yes":"No":"Not verified"}/><DetailFact label="Fork" value={typeof repo.fork==="boolean"?repo.fork?"Yes":"No":"Not verified"}/>
  <DetailFact label="Stated licence" value={text(repo.license)}/>
 </dl></article>) : <p className="small">No usable repository record was returned. The absence of a record does not establish that there is no public code.</p>}
 <p className="small muted">At most two directly reported repositories were checked. Repository creation is not the project’s launch date; activity is not a code audit or proof of ownership.</p></section>;
}
function RelatedLinks({links}: {links:unknown}) {
 const usable=rows(links).filter(link=>link.kind!=="risk"&&safeLink(link.url));
 return <section className="panel"><h2>Identity &amp; project links</h2>{usable.length ? <div className="link-grid">{usable.map((link,index)=><div className="link-item" key={index}><DetailLink url={link.url}>{link.kind==="market"?"Market chart":link.kind==="explorer"?"Exact-token explorer":displayLinkLabel(link,"Project link")}</DetailLink></div>)}</div> : <p className="small">No usable supporting links were saved.</p>}<p className="small muted">Match the exact address and network. Names, logos and reported account links do not authenticate the project or team.</p></section>;
}
function ChecksDetails({report}: {report:Item}) {
 return <details className="panel report-checks" id="checks"><summary>Checks &amp; gaps</summary><div className="stack"><ReportSources report={report}/></div></details>;
}

// Content only: the route owns navigation, page heading, shell and attribution.
// This projection never mutates evidence, scores or stored report values.
export default function ReportDetail({report, id, section}: {report:Item; id:string; section:string}) {
 const r=object(presentResearchReport(report)), identity=object(r.identity), target=object(r.target), m=object(r.metrics), research=object(r.research);
 const findings=rows(r.findings), sources=rows(r.sources), market=object(research.market);
 const priceTrend=section==="momentum"?marketSnapshot(report).trend:null;
 const relevant=(categories:string[],codes:string[]=[])=>findings.filter(finding=>categories.includes(finding.category)||codes.includes(finding.code));
 let content:ReactNode;
 switch(section){
  case "summary": {
   const priority=(finding:Item)=>finding.hardFail?0:finding.severity==="danger"?1:finding.severity==="warn"?2:finding.severity==="unknown"?3:4;
   const ordered=[...findings].sort((a,b)=>priority(a)-priority(b));
   content=<><ReportVerdict report={r}/><div id="all-findings" className="stack"><ProsCons report={report} reportId={id} detailed/>{typeof research.whyItMightRun==="string"&&research.whyItMightRun.trim()&&<section className="panel"><h2>Market context</h2><p>{research.whyItMightRun}</p></section>}<div id="finding-details"><DetailFindings findings={ordered} title="All findings · warnings first"/></div></div></>;
   break;
  }
  case "identity": {
   const identityChecks=sources.filter(source=>["Solana mint","Blockscout token","DEX market","GeckoTerminal market"].includes(source.name));
   const chainBasis=target.chainResolution==="Unique exact-base-token match in DEX Screener; verify the selected network independently."?"One exact base-token match in the returned market index; network identity still needs independent confirmation.":text(target.chainResolution);
   content=<><section className="panel"><h2>Exactly which token?</h2><dl className="facts"><DetailFact label="Network" value={text(identity.chain,text(target.chain))}/><DetailFact label="Exact mint / contract" value={<span className="mono">{text(target.address)}</span>}/><DetailFact label="Reported name" value={text(identity.name)}/><DetailFact label="Reported ticker" value={text(identity.symbol)}/><DetailFact label="How the network was selected" value={chainBasis}/><DetailFact label="Launchpad provenance" value={identity.launchpadVerified===true?"Reported by the checked evidence":"Not verified"}/><DetailFact label="Token program" value={<span className="mono">{text(identity.tokenProgram)}</span>}/><DetailFact label="Metadata update authority" value={<span className="mono">{text(identity.updateAuthority)}</span>}/></dl><p className="small muted">A metadata update authority is not automatically the creator. Names and tickers can be copied; this report is anchored to one address on one network.</p></section>
   <section className="panel"><h2>Identity matching checks</h2>{identityChecks.length?<div className="stack">{identityChecks.map((source,index)=>{const onchain=["Solana mint","Blockscout token"].includes(source.name);return <div className="source-row" key={index}><div><strong>{onchain?"Exact on-chain token check":"Market lookup response"}</strong><p className="small">{source.ok===true?onchain?"Matching data returned":"Response returned":"Not verified"} · Checked {detailDate(source.checkedAt)}</p></div>{safeLink(source.url)&&<DetailLink url={source.url}>Inspect evidence</DetailLink>}</div>;})}</div>:<p className="small">No identity-matching check records were saved.</p>}</section>
   <DetailFindings findings={relevant(["Identity","Creator"])} title="Identity & creator findings"/><CreatorDetails research={research} metrics={m}/><RelatedLinks links={research.links}/></>;
   break;
  }
  case "integrity":
   content=<><section className="panel"><h2>Token structure &amp; control</h2><dl className="facts"><DetailFact label="Supply" value={tokenSupply(m.totalSupply??m.supply,m.decimals)}/><DetailFact label="Decimals" value={detailNumber(m.decimals)}/><DetailFact label="Mint authority" value={authority(m.mintAuthorityStatus,m.mintAuthority)}/><DetailFact label="Freeze authority" value={authority(m.freezeAuthorityStatus,m.freezeAuthority)}/><DetailFact label="Owner address reported" value={<span className="mono">{text(m.ownerAddress)}</span>}/><DetailFact label="Liquidity lock reported" value={detailNumber(m.lpLockedPct,"%")}/><DetailFact label="Pool liquidity" value={detailMoney(m.liquidityUsd)}/><DetailFact label="Buy tax reported" value={detailNumber(taxPercent(m.buyTax),"%")}/><DetailFact label="Sell tax reported" value={detailNumber(taxPercent(m.sellTax),"%")}/></dl><p className="small muted">These are the returned checks, not a full contract audit. A lock percentage or tax estimate does not guarantee an executable sale.</p></section><HolderDetails metrics={m}/><DetailFindings findings={relevant(["Authority","On-chain risk","Sellability","Contract","Liquidity","Distribution"])} title="Controls, sellability & distribution findings"/></>;
   break;
  case "project":
   content=<><ProjectProfile report={report}/><CreatorDetails research={research} metrics={m}/><RepositoryDetails research={research}/><DetailFindings findings={relevant(["Authenticity","Creator"])} title="Project & authenticity findings"/><PublicWebResearch report={report}/></>;
   break;
  case "momentum":
   content=<><section className="panel"><div className="row spread"><h2>A moment in the market</h2>{safeLink(market.poolUrl)&&<DetailLink url={market.poolUrl}>Open chart</DetailLink>}</div><dl className="facts"><DetailFact label="Price" value={detailMoney(m.priceUsd)}/><DetailFact label="Market cap" value={detailMoney(m.marketCap)}/><DetailFact label="Fully diluted value" value={detailMoney(m.fdv)}/><DetailFact label="Pool liquidity" value={detailMoney(m.liquidityUsd)}/><DetailFact label="24-hour volume" value={detailMoney(m.volume24h)}/><DetailFact label="Selected pool created" value={detailDate(m.pairCreatedAt)}/></dl><p className="small muted">The selected pool is not total cross-pool liquidity or an executable quote. Pool creation is not the token’s launch date.</p><MarketWindows windows={market.windows}/><p className="small muted">A timestamped market snapshot, not a live stream or a prediction. Volume and price moves can be manipulated.</p></section><DetailFindings findings={relevant(["Market","Liquidity"],["PAID_BOOSTS"])} title="Market & momentum findings"/></>;
   break;
  case "activity":
   content=<><TradingActivity report={{target:r.target,generatedAt:r.generatedAt,metrics:m,sources:r.sources,research:{market,buyerActivity:research.buyerActivity,freshness:research.freshness}}}/><BuyerBehaviour report={report} reportId={id}/><HolderDetails metrics={m}/><DetailFindings findings={relevant(["Distribution"],["NO_SELL_FLOW","FLOW_VISIBLE","PAID_BOOSTS","HONEYPOT","CANNOT_SELL","SELLABILITY_PARTIAL","SELL_SIMULATION_UNAVAILABLE"])} title="Flow, insider & selling evidence"/><p className="small muted">This check does not establish organic demand, complete wallet relationships, holder growth or historic trading profitability.</p></>;
   break;
  default:
   content=<section className="panel"><h2>Section not available</h2><p>Choose a section from this report’s navigation.</p></section>;
 }
 return <div className="report-detail stack" data-report-id={id} data-report-section={section}>{priceTrend&&<section className="panel"><h2>Price direction · {priceTrend.label}</h2><p>{priceTrend.detail}</p></section>}{content}<ChecksDetails report={report}/></div>;
}
