import { presentResearchReport } from "./report-presentation.js";

const text = value => typeof value === "string" ? value.trim() : "";
const emptyRiskTitles = ["No RugCheck warnings returned", "No listed on-chain warnings returned", "No warnings in the returned risk list", "No additional warnings in the risk list"];
const emptyRiskNarrative = value => emptyRiskTitles.some(title => value === title || value.startsWith(`${title}: `));
const rank = item => item.hardFail ? 0 : item.severity === "danger" ? 1 : 2;

// Only compact known generated wording. Values come from the recorded finding,
// not a newer/conflicting metric. Unknown/custom prose keeps its qualifications.
function findingText(item) {
  const title = text(item.title), detail = text(item.detail);
  let match;
  switch (item.code) {
    case "MINT_AUTHORITY_REVOKED":
      if (title === "Mint authority revoked" && detail === "The parsed mint account reports no active mint authority.") return "Mint authority revoked.";
      break;
    case "FREEZE_AUTHORITY_REVOKED":
      if (title === "Freeze authority revoked" && detail === "The parsed mint account reports no active freeze authority.") return "Freeze authority revoked.";
      break;
    case "SOL_TOP_HOLDER_MODERATE":
      match = detail.match(/^Largest non-market balance in the returned holder snapshot: (\d+(?:\.\d+)?%)\. This is not a complete map of beneficial ownership or linked wallets\.$/);
      if (title === "No exposed holder above 5% in the snapshot" && match) return `Largest returned non-market balance: ${match[1]} (snapshot only).`;
      break;
    case "TOP_HOLDER_MODERATE":
      match = detail.match(/^Largest non-protocol balance: (\d+(?:\.\d+)?%)\. Labels can be incomplete\.$/);
      if (title === "No exposed holder above 5% in this page" && match) return `Largest returned non-protocol balance: ${match[1]}; labels may be incomplete.`;
      break;
    case "LP_LOCKED":
    case "LP_UNLOCKED":
      match = detail.match(/^The lowest reported pool lock is (\d+(?:\.\d+)?%)\.$/);
      if (["Liquidity lock reported", "Material liquidity appears unlocked"].includes(title) && match) return `Lowest reported pool lock: ${match[1]}.`;
      break;
    case "LIQUIDITY_VISIBLE":
      match = detail.match(/^Approximately (\$[\d,.]+) is reported in the strongest indexed pool\.$/);
      if (title === "Liquidity is visible" && match) return `Largest indexed pool: about ${match[1]} liquidity.`;
      break;
    case "LIQUIDITY_LOW":
      match = detail.match(/^About (\$[\d,.]+) of liquidity is visible\.$/);
      if (title === "Low liquidity" && match) return `Low liquidity: about ${match[1]} visible.`;
      break;
    case "LIQUIDITY_CRITICAL":
      match = detail.match(/^Only about (\$[\d,.]+) of liquidity is visible\. Exits can become impossible or extremely expensive\.$/);
      if (title === "Extremely thin liquidity" && match) return `Only about ${match[1]} liquidity; selling may be impossible or costly.`;
      break;
    case "INSIDER_GRAPH":
      match = detail.match(/^The security check flags (\d+|one or more) possible insider network\(s\)\. The wallet relationships and beneficial ownership have not been independently verified\.$/);
      if (title === "Possible linked insider network flagged" && match) return `${match[1] === "one or more" ? "One or more" : match[1]} possible insider network${match[1] === "1" ? "" : "s"} flagged; links unverified.`;
      break;
    case "INSIDER_SUPPLY_HIGH":
    case "INSIDER_SUPPLY_ELEVATED":
      match = detail.match(/^The security check attributes approximately (\d+(?:\.\d+)?%) to possible insiders\. These labels and linked-wallet ownership have not been independently verified\.$/);
      if (["High insider concentration", "Elevated insider concentration"].includes(title) && match) return `About ${match[1]} attributed to possible insiders; ownership unverified.`;
      break;
    case "TOKEN_EXTENSIONS":
      if (title === "Token extensions require review") {
        if (/^Detected: (metadataPointer, tokenMetadata|tokenMetadata, metadataPointer)\.$/.test(detail)) return "Metadata extensions need review.";
        if (/^Detected: [A-Za-z0-9_, -]+\.$/.test(detail)) return `${title}.`;
      }
      break;
    case "MINT_AUTHORITY_ACTIVE":
      if (title === "Mint authority is active" && /^Authority [1-9A-HJ-NP-Za-km-z]{32,44} may be able to create more supply\.$/.test(detail)) return "Active mint authority may create more tokens.";
      break;
    case "FREEZE_AUTHORITY_ACTIVE":
      if (title === "Freeze authority is active" && /^Authority [1-9A-HJ-NP-Za-km-z]{32,44} may be able to freeze token accounts\.$/.test(detail)) return "Active freeze authority may freeze token accounts.";
      break;
    case "RUGCHECK_RUGGED":
      if (title === "Rug-pull warning returned" && detail === "The security check flags this mint as potentially having suffered a rug pull. This warning has not been independently proven by OLWIF.") return "Possible rug pull flagged; not independently proven.";
      break;
    case "NO_SELL_FLOW":
      if (title === "No sells in recent indexed flow" && detail === "This can be innocent during a new launch, but it can also indicate exit restrictions. Confirm with a sell simulation.") return "No recent indexed sells; possible exit restrictions need checking.";
      break;
    case "NO_PROJECT_LINKS":
      if (title === "No indexed project links" && detail === "The checked market and metadata sources did not return usable website or social links. This is not proof that none exist.") return "No usable project links returned by these checks.";
      break;
    case "SOURCE_VERIFIED":
      if (title === "Contract source is verified" && detail === "The explorer returned verified contract information.") return "Verified contract source available (not a code audit).";
      break;
    case "PROXY_CONTRACT":
      if (title === "Upgradeable/proxy structure detected" && detail === "Confirm the implementation, administrator and upgrade timelock during independent review.") return "Upgradeable contract; administrator and upgrade controls need review.";
      break;
  }
  return title && detail && title !== detail ? `${title}: ${detail}` : title || detail;
}

/** Brief, read-only candidates. The caller controls visible counts, not evidence. */
export function reportProsCons(report) {
  const shown = presentResearchReport(report);
  if (!shown || typeof shown !== "object") return { pros: [], cons: [] };
  const findings = (Array.isArray(shown.findings) ? shown.findings : []).filter(item => item && typeof item === "object");
  const rawFindings = Array.isArray(report.findings) ? report.findings : [];
  const associatedNarratives = new Set();
  for (const item of [...rawFindings, ...findings]) {
    if (!item || typeof item !== "object") continue;
    const title = text(item.title), detail = text(item.detail);
    if (title) associatedNarratives.add(title);
    if (detail) associatedNarratives.add(detail);
    if (title && detail) associatedNarratives.add(`${title}: ${detail}`);
  }
  const pros = [], cons = [];
  for (const item of findings) {
    const negative = item.hardFail === true || ["danger", "warn"].includes(item.severity);
    if (!negative && (item.severity !== "good" || item.code === "RUGCHECK_NO_LISTED_RISKS")) continue;
    const value = findingText(item);
    if (!value && !negative) continue;
    (negative ? cons : pros).push({
      text: value || "A warning was returned without explanatory text.",
      code: item.code, severity: item.severity, hardFail: item.hardFail === true
    });
  }
  for (const [key, destination, severity] of [["strengths", pros, "good"], ["concerns", cons, "warn"]]) {
    const values = Array.isArray(shown.research?.[key]) ? shown.research[key] : [];
    for (const value of values) {
      const narrative = text(value);
      if (!narrative || associatedNarratives.has(narrative) || (key === "strengths" && emptyRiskNarrative(narrative))) continue;
      // Standalone cached prose (for example archived-repository evidence) must
      // survive even when it has no corresponding finding code. Do not truncate.
      destination.push({ text: narrative, severity, hardFail: false });
    }
  }
  const unique = rows => rows.filter((row, index) => rows.findIndex(other => other.text === row.text && other.code === row.code && other.severity === row.severity && other.hardFail === row.hardFail) === index);
  const concisePros = unique(pros);
  const mint = concisePros.findIndex(row => row.code === "MINT_AUTHORITY_REVOKED" && row.text === "Mint authority revoked.");
  const freeze = concisePros.findIndex(row => row.code === "FREEZE_AUTHORITY_REVOKED" && row.text === "Freeze authority revoked.");
  if (mint !== -1 && freeze !== -1) {
    concisePros[Math.min(mint, freeze)] = {
      text: "Mint and freeze authorities revoked.", code: "MINT_AND_FREEZE_REVOKED",
      codes: ["MINT_AUTHORITY_REVOKED", "FREEZE_AUTHORITY_REVOKED"], severity: "good", hardFail: false
    };
    concisePros.splice(Math.max(mint, freeze), 1);
  }
  return { pros: concisePros, cons: unique(cons).sort((a, b) => rank(a) - rank(b)) };
}
