const X_HOSTS = new Set(["x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com", "m.twitter.com"]);
const X_LABEL = /^(?:@?twitter(?:\s+(?:profile|account))?|twitter\s*\/\s*x|x\s*\/\s*twitter|x(?:\s*\(\s*(?:formerly\s+)?twitter\s*\))?)$/i;

// Providers still use legacy field names. Update the visible platform label,
// including old saved reports, without rewriting evidence or link destinations.
export function displayLinkLabel(link, fallback = "Project link") {
  if (!link || typeof link !== "object") return fallback;
  for (const value of [link.label, link.type]) {
    if (typeof value === "string" && X_LABEL.test(value.trim())) return "X";
  }
  try {
    const url = new URL(link.url);
    if (["https:", "http:"].includes(url.protocol) && !url.username && !url.password && X_HOSTS.has(url.hostname)) return "X";
  } catch { /* Missing or invalid URLs keep their non-platform label. */ }
  return typeof link.label === "string" && link.label.trim() ? link.label : fallback;
}
