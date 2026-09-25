const WINDOWS = {"5m":5,"1h":60,"6h":360,"24h":1440};
const count = value => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const amount = value => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

// Presentation only: select actual returned observations, not a score, inferred
// unique-wallet count, or forecast. In particular, zero is usable evidence.
export function tradingActivity(report = {}) {
 const windows = (Array.isArray(report.research?.market?.windows) ? report.research.market.windows : [])
  .filter(row => row && Object.hasOwn(WINDOWS,row.window))
  .map(row => ({window:row.window,buys:count(row.buys),sells:count(row.sells),transactions:count(row.transactions),volumeUsd:amount(row.volumeUsd)}))
  .sort((a,b) => WINDOWS[a.window] - WINDOWS[b.window]);
 const complete = windows.find(row => row.buys !== null && row.sells !== null);
 const partial = windows.find(row => row.buys !== null || row.sells !== null || row.transactions !== null || row.volumeUsd !== null);
 const selected = complete || partial || null;
 const warnings = (Array.isArray(report.findings) ? report.findings : [])
  .filter(item => item && (item.category === "Distribution" || item.code === "NO_SELL_FLOW") && (item.hardFail || ["danger","warn"].includes(item.severity)))
  .map((item,index) => ({title:typeof item.title === "string" ? item.title : "Trading activity needs review",critical:item.hardFail === true || item.severity === "danger",index}))
  .sort((a,b) => Number(b.critical) - Number(a.critical) || a.index - b.index)
  .map(({index,...item}) => item);
 return {selected,complete:!!complete,warnings,checkedAt:report.generatedAt || null};
}
