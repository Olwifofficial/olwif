// A display-only projection: evidence, scoring inputs and attribution stay intact.
// Only known OLWIF-generated sentences are rewritten. Never run provider-name
// replacements over token names, project claims, addresses, links or raw data.
function presentFinding(finding, hasRugPullFlag) {
  if (!finding || typeof finding !== "object") return finding;
  let { title, detail } = finding;
  const titleIs = (old, next) => { if (title === old) title = next; };
  const detailIs = (old, next) => { if (detail === old) detail = next; };

  switch (finding.code) {
    case "RUGCHECK_NO_LISTED_RISKS":
      for (const old of ["No RugCheck warnings returned", "No listed on-chain warnings returned", "No warnings in the returned risk list"]) {
        titleIs(old, hasRugPullFlag ? "No additional warnings in the risk list" : "No warnings in the returned risk list");
      }
      detailIs(
        "This is a useful signal, not a guarantee that the creator or market is safe.",
        "This applies only to the returned list. Other findings and gaps still apply; an empty list does not establish safety."
      );
      break;
    case "RUGCHECK_RUGGED":
      titleIs("Token is marked rugged", "Rug-pull warning returned");
      detailIs(
        "RugCheck's current report marks this mint as rugged.",
        "The security check flags this mint as potentially having suffered a rug pull. This warning has not been independently proven by OLWIF."
      );
      break;
    case "INSIDER_GRAPH":
      titleIs("Linked insider network detected", "Possible linked insider network flagged");
      if (typeof detail === "string") {
        detail = detail.replace(
          /^RugCheck reported (\d+|one or more) insider network\(s\)\.$/,
          "The security check flags $1 possible insider network(s). The wallet relationships and beneficial ownership have not been independently verified."
        );
      }
      break;
    case "INSIDER_SUPPLY_HIGH":
    case "INSIDER_SUPPLY_ELEVATED":
      if (typeof detail === "string") {
        detail = detail.replace(
          /^Approximately (\d+(?:\.\d+)?%) is attributed to insiders\.$/,
          "The security check attributes approximately $1 to possible insiders. These labels and linked-wallet ownership have not been independently verified."
        );
      }
      break;
    case "SOL_TOP_HOLDER_MODERATE":
      titleIs("No exposed holder above 5%", "No exposed holder above 5% in the snapshot");
      if (typeof detail === "string") {
        detail = detail.replace(
          /^Largest non-market balance in the RugCheck snapshot: (\d+(?:\.\d+)?%|unknown)\.$/,
          "Largest non-market balance in the returned holder snapshot: $1. This is not a complete map of beneficial ownership or linked wallets."
        );
      }
      break;
    case "PAID_BOOSTS":
      if (typeof detail === "string") {
        detail = detail.replace(
          /^(\d+(?:\.\d+)?) active boost\(s\) are reported by DEX Screener\. Paid exposure is not proof of organic demand\.$/,
          "$1 active paid visibility boost(s) appear in the market snapshot. Paid exposure is not proof of organic demand."
        );
      }
      break;
    case "TOKEN_FOUND":
      titleIs("Exact token found on Blockscout", "Exact token address confirmed");
      // The detail includes the project's own name and symbol; keep it verbatim.
      break;
    case "GOPLUS_SOURCE_UNVERIFIED":
      titleIs("Security provider reports unverified source", "Contract source reported as unverified");
      detailIs(
        "GoPlus marks the source as not open/verified. This app has not independently reviewed the bytecode or source.",
        "The security check marks the contract source as not open or verified. OLWIF has not independently reviewed the bytecode or source."
      );
      break;
    case "GOPLUS_SOURCE_REPORTED":
      titleIs("Security provider reports open source", "Contract source availability reported");
      detailIs(
        "GoPlus reports source availability. Review the explorer source and administration; this is not an audit.",
        "The security check indicates that contract source code is available. Review the explorer source and administration; this is not an audit."
      );
      break;
    case "SELL_SIMULATION_UNAVAILABLE":
      detailIs(
        "GoPlus did not return coverage for this chain/address. A yellow result must not be treated as confirmed sellability.",
        "The security check did not return coverage for this chain and address. A yellow result must not be treated as confirmed sellability."
      );
      break;
    case "HOLDERS_SECURITY_SNAPSHOT":
      titleIs("Holder snapshot from GoPlus", "Holder balance snapshot");
      break;
  }

  // These two exact strings are OLWIF fallbacks, not external risk descriptions.
  if (typeof finding.code === "string" && finding.code.startsWith("RUGCHECK_")) {
    titleIs("RugCheck signal", "On-chain security signal");
    detailIs("Risk signal returned by RugCheck.", "A risk signal was returned by the security check; further details were not supplied.");
  }
  return { ...finding, title, detail };
}

/**
 * Return plain-language report copy without changing the stored research.
 * Consumers should keep the original report for their Sources & gaps section.
 * Numeric evidence, source metadata, finding codes/severity and ratings are
 * shared untouched, rather than recalculated from this presentation wording.
 */
export function presentResearchReport(report) {
  if (!report || typeof report !== "object") return report;
  const originals = Array.isArray(report.findings) ? report.findings : [];
  const hasRugPullFlag = originals.some(finding => finding?.code === "RUGCHECK_RUGGED");
  const findings = originals.map(finding => presentFinding(finding, hasRugPullFlag));
  const narrative = new Map();
  const contradictoryStrengths = new Set();
  const remember = (before, after) => {
    if (typeof before === "string" && before && before !== after) narrative.set(before, after);
  };
  for (let index = 0; index < originals.length; index++) {
    const before = originals[index], after = findings[index];
    if (!before || !after) continue;
    if (hasRugPullFlag && before.code === "RUGCHECK_NO_LISTED_RISKS") {
      for (const finding of [before, after]) {
        contradictoryStrengths.add(finding.title);
        contradictoryStrengths.add(finding.detail);
        contradictoryStrengths.add(`${finding.title}: ${finding.detail}`);
      }
    }
    remember(before.title, after.title);
    remember(before.detail, after.detail);
    // Cached reports contain these generated strings rather than references to
    // the finding. Exact matching also preserves unrelated repository concerns.
    if (typeof before.title === "string" && typeof before.detail === "string") {
      remember(`${before.title}: ${before.detail}`, `${after.title}: ${after.detail}`);
      remember(`${before.title}: ${before.detail || "Not verified."}`, `${after.title}: ${after.detail || "Not verified."}`);
    }
  }
  const text = value => narrative.has(value) ? narrative.get(value) : value;
  const list = value => Array.isArray(value) ? value.map(text) : value;
  const display = { ...report };
  if (Array.isArray(report.findings)) display.findings = findings;
  if (Object.hasOwn(report, "summary")) display.summary = text(report.summary);
  if (report.research && typeof report.research === "object") {
    display.research = { ...report.research };
    for (const key of ["strengths", "concerns", "unknowns"]) {
      if (Object.hasOwn(report.research, key)) display.research[key] = list(report.research[key]);
    }
    // Older snapshots can contain an empty risk list alongside a separate rug
    // flag. Keep both findings as evidence, but do not advertise the empty list
    // as a strength in that contradictory case.
    if (hasRugPullFlag && Array.isArray(display.research.strengths)) {
      display.research.strengths = display.research.strengths.filter(value => !contradictoryStrengths.has(value));
    }
    for (const key of ["mainConcern", "summary"]) {
      if (Object.hasOwn(report.research, key)) display.research[key] = text(report.research[key]);
    }
  }
  return display;
}
