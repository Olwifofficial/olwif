"use client";

import {useId,useState} from "react";
import {ACTIVITY_PERIODS,activityWindow} from "@/lib/research/activity-window.js";
import {safeLink} from "@/lib/security";

const number=(value:unknown)=>typeof value==="number"&&Number.isFinite(value)?value.toLocaleString("en-GB",{maximumFractionDigits:2}):"—";
const money=(value:unknown,compact=false)=>typeof value==="number"&&Number.isFinite(value)?new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",notation:compact?"compact":"standard",maximumFractionDigits:2}).format(value):"—";
const date=(value:unknown)=>typeof value==="string"&&Number.isFinite(Date.parse(value))?new Date(value).toISOString().replace("T"," ").slice(0,19)+" UTC":"Not recorded";

export default function TradingActivity({report}:{report:Record<string,unknown>}) {
 const [period,setPeriod]=useState("5m");
 const selectorId=useId();
 const window=activityWindow(report,period);
 const research=report.research as {market?:{poolUrl?:unknown}}|undefined;
 const poolUrl=safeLink(research?.market?.poolUrl);
 const basis=window.status==="indexed"?"Market snapshot":window.status==="sample"?window.partial?"Partial sample":"Sampled trades":"No saved data";
 return <section className="panel trading-activity-compact" aria-labelledby={`${selectorId}-heading`}>
  <div className="trading-activity-heading">
   <h2 id={`${selectorId}-heading`}>Trading activity</h2>
   <label className="activity-period-control" htmlFor={selectorId}><span>Time window</span>
    <select id={selectorId} value={period} onChange={event=>setPeriod(event.target.value)}>{ACTIVITY_PERIODS.map(option=><option value={option.value} key={option.value}>{option.label}</option>)}</select>
   </label>
  </div>
  <div className="activity-period-result" role="status" aria-live="polite" aria-atomic="true">
   <dl className="activity-period-metrics">
    <div><dt>Buys</dt><dd aria-label={window.buys==null?"Buys not available":undefined}>{number(window.buys)}</dd></div>
    <div><dt>Sells</dt><dd aria-label={window.sells==null?"Sells not available":undefined}>{number(window.sells)}</dd></div>
    <div><dt>Volume · USD</dt><dd title={money(window.volumeUsd)} aria-label={window.volumeUsd==null?"Volume not available":money(window.volumeUsd)}>{money(window.volumeUsd,true)}</dd></div>
   </dl>
   <div className="activity-period-context"><span className="tag">{basis} · {window.label}</span><span>Saved check, not live</span></div>
   {(window.status!=="indexed"||window.partial)&&<p className="small activity-period-note">{window.status==="sample"?"Saved trade sample only — not a full-period total.":window.status==="indexed"?"Some figures were not returned for this period.":"No saved data for this period. Refresh the report to request a new sample."}</p>}
  </div>
  <details className="activity-period-detail">
   <summary>More detail</summary>
   <dl className="facts">
    <div className="fact"><dt>{window.status==="sample"?"Sampled trades":"Transactions"}</dt><dd>{number(window.transactions)}</dd></div>
    <div className="fact"><dt>Price change</dt><dd>{window.priceChangePct==null?"Not available":`${number(window.priceChangePct)}%`}</dd></div>
    <div className="fact"><dt>Collected</dt><dd>{date(window.checkedAt)}</dd></div>
   </dl>
   <p className="small">Selected period: {date(window.startAt)} – {date(window.endAt)}.</p>
   <p className="small">{window.message}</p>
   <p className="small muted">Trades are not unique people. Short periods use saved individual trades where available; missing history is not estimated. The buyer-behaviour section below keeps its own labelled sample period.</p>
   {poolUrl&&<a className="inline-link" href={poolUrl} target="_blank" rel="noopener noreferrer">Inspect selected pool ↗</a>}
  </details>
 </section>;
}
