const WINDOW_ORDER = { "5m": 5, "1h": 60, "6h": 360, "24h": 1440 };
const amount = value => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const change = value => typeof value === "number" && Number.isFinite(value) && value >= -100 ? value : null;
const direction = value => value > 1 ? 1 : value < -1 ? -1 : 0;

// Presentation only. These labels describe saved endpoint changes, not a chart
// pattern, forecast, buy signal, safety rating or continuously updated quote.
export function marketSnapshot(input = {}) {
 const report = input && typeof input === "object" ? input : {};
 const rows = Array.isArray(report.research?.market?.windows) ? report.research.market.windows : [];
 const values = new Map(), rejected = new Set();
 let invalid = false;
 for (const row of rows) {
  if (!row || !Object.hasOwn(WINDOW_ORDER, row.window)) continue;
  const value = change(row.priceChangePct);
  if (value === null) {
   // Empty windows are normal when a young market has no returned history.
   if (row.priceChangePct != null || values.has(row.window)) invalid = true;
   rejected.add(row.window);
   continue;
  }
  if (rejected.has(row.window) || (values.has(row.window) && values.get(row.window) !== value)) {
   invalid = true;
   rejected.add(row.window);
  }
  values.set(row.window, value);
 }
 const windows = [...values].filter(([window]) => !rejected.has(window))
  .sort(([a], [b]) => WINDOW_ORDER[a] - WINDOW_ORDER[b])
  .map(([window, priceChangePct]) => ({ window, priceChangePct }));
 const observations = windows.map(row => `${row.window}: ${row.priceChangePct > 0 ? "+" : ""}${row.priceChangePct}%`).join(" · ");
 const suffix = `${observations ? `Recorded changes: ${observations}. ` : ""}Saved snapshot; not a forecast. Endpoint changes do not establish consolidation.`;
 const result = (label, tone, reason) => ({
  marketCapUsd: amount(report.metrics?.marketCap),
  priceUsd: amount(report.metrics?.priceUsd),
  trend: { label, tone, detail: `${reason} ${suffix}`, windows }
 });
 const findings = Array.isArray(report.findings) ? report.findings : [];
 if (findings.some(row => row?.code === "MARKET_SOURCE_DISAGREEMENT")) {
  return result("Snapshot incomplete", "unknown", "Market prices disagree across the saved checks, so no directional label is assigned.");
 }
 const provider = report.research?.market?.provider;
 const sourceName = provider === "DEX Screener" ? "DEX market" : provider === "GeckoTerminal" ? "GeckoTerminal market" : null;
 const sources = (Array.isArray(report.sources) ? report.sources : []).filter(row => sourceName && row?.name === sourceName);
 if (sources.length && !sources.some(row => row.ok === true)) {
  return result("Snapshot incomplete", "unknown", "The saved market-source check did not complete successfully.");
 }
 if (invalid) return result("Snapshot incomplete", "unknown", "Some price-change entries are invalid or conflicting; they are excluded and no directional label is assigned.");
 if (!windows.length) return result("Trend unavailable", "unknown", "No usable price-change windows were returned.");
 if (windows.length === 1) {
  const only = windows[0], sign = direction(only.priceChangePct);
  return result(`${sign > 0 ? "Rising" : sign < 0 ? "Falling" : "Little net change"} (${only.window})`, sign > 0 ? "up" : sign < 0 ? "down" : "neutral", "Only this window is available. Rising/falling means a change greater than 1% in that direction; within ±1% means little net change.");
 }
 const recent = windows.find(row => row.window === "5m"), hourly = windows.find(row => row.window === "1h");
 if (!recent || !hourly) return result("Snapshot incomplete", "unknown", "Both 5-minute and 1-hour changes are needed for the combined trend label.");
 const signs = windows.map(row => direction(row.priceChangePct));
 if (direction(recent.priceChangePct) < 0 && signs.slice(1).includes(1)) {
  return result("Pulling back", "down", "The 5-minute change is below −1% while at least one longer returned window is above +1%.");
 }
 if (signs.includes(-1) && signs.includes(1)) {
  return result("Mixed direction", "neutral", "Returned windows include both gains above +1% and losses below −1%.");
 }
 if (recent.priceChangePct >= 5 && hourly.priceChangePct >= 10) {
  return result("Running up", "up", "Display rule: at least +5% over 5 minutes and +10% over 1 hour, with no returned longer window below −1%.");
 }
 if (direction(recent.priceChangePct) > 0 && direction(hourly.priceChangePct) > 0) {
  return result("Rising", "up", "Both the 5-minute and 1-hour changes are above +1%, with no returned longer window below −1%.");
 }
 if (direction(recent.priceChangePct) < 0 && direction(hourly.priceChangePct) < 0) {
  return result("Falling", "down", "Both the 5-minute and 1-hour changes are below −1%, with no returned longer window above +1%.");
 }
 if (signs.every(sign => sign === 0)) {
  return result("Little net change", "neutral", "Every returned window is within ±1%. Prices may still have moved sharply between these endpoints.");
 }
 return result("Mixed direction", "neutral", "The 5-minute and 1-hour changes do not show a consistent move beyond ±1% across the returned windows.");
}
