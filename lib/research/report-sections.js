export const REPORT_SECTIONS = [
 {slug:"summary",title:"O’s take",description:"The main findings, warnings and reasons behind this result."},
 {slug:"identity",title:"Token check",assessment:"Identity",description:"Which token this is, which network it uses and who is recorded as its creator."},
 {slug:"integrity",title:"Risk checks",assessment:"Integrity",description:"Who can change the token, how holdings are spread and which warnings were found."},
 {slug:"project",title:"People & project",assessment:"Substance",description:"The project’s website, public accounts, people and development work found in this check."},
 {slug:"momentum",title:"Price & market",assessment:"Momentum",description:"How the price has moved and how much trading and liquidity were recorded."},
 {slug:"activity",title:"Buying & selling",assessment:"Flow quality",description:"Recorded buys and sells, wallet activity and any related warnings."},
];
export function findReportSection(slug) {
 return typeof slug === "string" ? REPORT_SECTIONS.find(section => section.slug === slug) || null : null;
}
export function sectionForAssessment(name) {
 return REPORT_SECTIONS.find(section => section.assessment === name)?.slug || null;
}
export function reportSectionUrl(id, slug) {
 return typeof id === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(id) && findReportSection(slug) ? `/report/${encodeURIComponent(id)}/${slug}` : null;
}
