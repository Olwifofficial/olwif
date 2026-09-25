// Presentation only: derive the light from saved evidence, never price or momentum.
// Missing evidence must not turn green simply because no warning was returned.
export function reportTrafficLight(report = {}) {
  const findings = Array.isArray(report.findings) ? report.findings : [];
  const sources = Array.isArray(report.sources) ? report.sources : [];
  const research = report.research || {};
  const serious = findings.some(item => item?.hardFail || item?.severity === "danger");
  if (serious || report.hardFailCount > 0 || ["REJECT", "RED"].includes(report.tier)) {
    return { color: "red", label: "RED · Serious warnings", reason: "A serious warning was reported. Read the findings before considering this project." };
  }
  if (findings.some(item => item?.severity === "warn") || research.concerns?.length || report.tier === "AMBER") {
    return { color: "amber", label: "YELLOW · Caution", reason: "Warnings need a closer look. This is not a clear result." };
  }

  const identityChecked = sources.some(source => source?.ok === true && ["Solana mint", "Blockscout token"].includes(source.name));
  const riskChecked = sources.some(source => source?.ok === true && ["RugCheck", "GoPlus security"].includes(source.name));
  const assessments = Array.isArray(research.assessments) ? research.assessments : [];
  // Affirmative allowlist: new or unfamiliar status wording stays amber.
  const completeStatuses = {
    Identity: "Verified on-chain",
    Integrity: "Checks passed",
    Substance: "Verified",
    "Flow quality": "Reviewed",
  };
  const incompleteAssessments = Object.entries(completeStatuses).some(([name, status]) => {
    const assessment = assessments.find(item => item?.name === name);
    return assessment?.status !== status;
  });
  const incomplete = !identityChecked || !riskChecked || !sources.length || !findings.length ||
    sources.some(source => source?.ok !== true) ||
    findings.some(item => !item || !["good", "info"].includes(item.severity)) ||
    !findings.some(item => item?.severity === "good") ||
    !Array.isArray(research.unknowns) || research.unknowns.length > 0 ||
    !Array.isArray(research.concerns) || incompleteAssessments || report.tier === "UNKNOWN";

  if (incomplete) {
    return { color: "amber", label: "YELLOW · More checks needed", reason: "Important evidence is missing or not independently verified. No warning found does not mean safe." };
  }
  return { color: "green", label: "GREEN · Listed checks clear", reason: "No warnings or gaps are recorded in the listed checks. This is not a safety guarantee or a recommendation to buy." };
}

// Each card summarises its own evidence, not the whole project. In particular,
// a green momentum card describes observed market direction, never safety.
export function assessmentTrafficLight(assessment = {}, report = {}) {
  const name = assessment.name;
  const findings = Array.isArray(report.findings) ? report.findings : [];
  const sources = Array.isArray(report.sources) ? report.sources : [];
  const categories = {
    Identity: ["Identity"],
    Integrity: ["Authority", "On-chain risk", "Sellability", "Contract", "Liquidity", "Distribution"],
    Substance: ["Authenticity", "Creator"],
    "Flow quality": ["Distribution"],
    Momentum: ["Market"],
  };
  const relevant = findings.filter(item => item && (
    categories[name]?.includes(item.category) || (name === "Flow quality" && item.code === "NO_SELL_FLOW")
  ));
  const light = color => ({color, label: color === "amber" ? "YELLOW" : color.toUpperCase()});
  if (relevant.some(item => item.hardFail || item.severity === "danger")) return light("red");
  if (relevant.some(item => !["good", "info"].includes(item.severity))) return light("amber");
  if (name === "Momentum") {
    const score = report.momentum?.score;
    const marketChecked = sources.some(source => source?.ok === true && ["DEX market", "GeckoTerminal market"].includes(source.name));
    if (!marketChecked || typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 100) return light("amber");
    if ((assessment.status === "Strong" && score >= 70) || (assessment.status === "Positive" && score >= 55 && score < 70)) return light("green");
    if (assessment.status === "Weak" && score < 40) return light("red");
    return light("amber");
  }
  if (name === "Identity") {
    const confirmed = sources.some(source => source?.ok === true && ["Solana mint", "Blockscout token"].includes(source.name));
    return light(assessment.status === "Verified on-chain" && confirmed ? "green" : "amber");
  }
  // Only affirmative states can be green; partial/missing/unfamiliar states stay yellow.
  const clearStatus = {Integrity: "Checks passed", Substance: "Verified", "Flow quality": "Reviewed"};
  return light(clearStatus[name] && assessment.status === clearStatus[name] && sources.length > 0 &&
    sources.every(source => source?.ok === true) && relevant.some(item => item.severity === "good") ? "green" : "amber");
}
