import {buyerBehaviour} from "@/lib/research/buyer-behaviour.js";

type SavedReport = {research?:{buyerActivity?:unknown}; [key:string]:unknown};
const count = (value:unknown) => typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("en-GB",{maximumFractionDigits:2}) : "Not enough data";
const date = (value:unknown) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString().replace("T"," ").slice(0,19)+" UTC" : "Not recorded";
const short = (value:string) => value.slice(0,6)+"…"+value.slice(-4);

export default function BuyerBehaviour({report,reportId}:{report:SavedReport;reportId:string}) {
 const activity=buyerBehaviour(report);
 if(activity.status!=="available") return <section className="panel buyer-behaviour" aria-labelledby="buyer-behaviour-title">
  <h2 id="buyer-behaviour-title">Buyer behaviour</h2>
  <p className="small">{!report.research?.buyerActivity ? "This saved report predates the buyer-behaviour check. Refresh the token report to collect a trade sample." : "A usable wallet-level trade sample was not returned for this pool. Buy and sell totals alone cannot tell us who is adding or buying at lower prices."}</p>
  {!report.research?.buyerActivity&&<a className="inline-link" href={`/report/${encodeURIComponent(reportId)}`}>Back to report to refresh</a>}
 </section>;
 const cards=[
  {key:"firstSeenRecently",title:"Newly seen",note:"First seen in this sample in the last 15 minutes."},
  {key:"repeatBuyers",title:"Buying again",note:"Addresses making two or more purchases."},
  {key:"netBuyers",title:"Net buying",note:"More tokens bought than sold in this sample."},
  {key:"buyingLower",title:"Buying lower",note:"Bought below their earlier sampled average price."},
 ] as const;
 const wallets=activity.wallets;
 return <section className="panel buyer-behaviour" aria-labelledby="buyer-behaviour-title">
  <div className="row spread"><h2 id="buyer-behaviour-title">Buyer behaviour</h2><span className="tag">Selected pool · saved sample</span></div>
  <p className="small">{count(activity.counts.buyers)} buying addresses across {count(activity.sample.tradeCount)} trades. {date(activity.sample.start)} – {date(activity.sample.end)}.</p>
  <div className="buyer-signal-grid">{cards.map(card=><div className="buyer-signal" key={card.key}>
   <h3>{card.title}</h3><strong className="buyer-signal-count">{count(activity.counts[card.key])}</strong><p>{card.note}</p>
   {(card.key==="netBuyers"||card.key==="buyingLower")&&<span className="small muted">{count(activity.coverage[card.key])} buying addresses assessable</span>}
  </div>)}</div>
  <p className="small buyer-sample-note">“Newly seen” does not mean a first-ever buyer. “Buying lower” is an observed price pattern, not confirmed averaging down. Addresses can include routers; these are not counts of individual people.</p>
  {wallets.length>0&&<details className="buyer-wallets"><summary>Explore buying addresses · {wallets.length} shown</summary>
   <p className="small muted">Most recent buying activity first. An address can appear in more than one group. Net tokens exclude transfers and activity outside this sample.</p>
   <div className="table-scroll"><table><caption className="sr-only">Buying address activity in the returned sample</caption><thead><tr><th scope="col">Address</th><th scope="col">Buys / sells</th><th scope="col">Net tokens</th><th scope="col">Observed behaviour</th><th scope="col">Last activity</th></tr></thead><tbody>{wallets.map(wallet=><tr key={wallet.wallet}>
    <td>{wallet.url?<a className="inline-link mono" href={wallet.url} target="_blank" rel="noopener noreferrer" aria-label={`Inspect address ${wallet.wallet}`} title={wallet.wallet}>{short(wallet.wallet)}</a>:<span className="mono">{wallet.wallet}</span>}</td>
    <td>{count(wallet.buyCount)} / {count(wallet.sellCount)}</td><td>{count(wallet.netTokens)}</td>
    <td><div className="buyer-flags">{wallet.flags.newInSample===true&&<span>Newly seen</span>}{wallet.flags.repeat===true&&<span>Buying again</span>}{wallet.flags.netBuyer===true&&<span>Net buying</span>}{wallet.flags.buyingLower===true&&<span>Buying lower</span>}{!Object.values(wallet.flags).some(flag=>flag===true)&&<span>Buy recorded</span>}</div></td>
    <td className="small">{date(wallet.lastSeen)}</td>
   </tr>)}</tbody></table></div>
  </details>}
  <details className="buyer-method"><summary>How to read these signals</summary>
   <ul className="small">{Object.entries(activity.definitions||{}).map(([key,value])=><li key={key}>{String(value)}</li>)}</ul>
   <p className="small">Up to 300 returned trades from the past 24 hours; busy pools may cover only minutes. No full holding history, transfers or activity in other pools is included. Net buying is not a confirmed increase in total holdings, and none of these signals prove organic demand.</p>
   <p className="small muted">Collected {date(activity.checkedAt)}. Missing amounts or prices are excluded from the relevant signal, not treated as zero. {activity.sample.discardedTrades>0?`${activity.sample.discardedTrades} unusable trade records excluded.`:""} Collection details and source links are in Checks &amp; gaps.</p>
  </details>
 </section>;
}
