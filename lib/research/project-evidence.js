// Display-only evidence model. A reported link is not an authenticated affiliation.
const list = value => Array.isArray(value) ? value.filter(item => item && typeof item === "object" && !Array.isArray(item)) : [];
const text = (value, limit = 240) => typeof value === "string" ? value.trim().slice(0, limit) : "";
const X_HOSTS = new Set(["x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"]);
const X_RESERVED = new Set(["home", "intent", "share", "search", "explore", "i", "compose", "settings", "login", "logout", "signup", "hashtag", "messages", "notifications", "privacy", "tos"]);
export function evidenceUrl(raw) {
  if (typeof raw !== "string" || raw.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(raw)) return null;
  try {
    const url = new URL(raw);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.port) return null;
    if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(url.hostname)) return null;
    if (/(^|\.)(localhost|local|internal|lan|home|test|invalid|onion)$/.test(url.hostname) || /(?:^|\.)(nip\.io|sslip\.io|localtest\.me|lvh\.me)$/.test(url.hostname)) return null;
    if ([...url.searchParams.keys()].some(key => /(?:key|token|secret|password|auth|session)/i.test(key))) return null;
    return url.href;
  } catch { return null; }
}
function linkInfo(link) {
  const url = evidenceUrl(link?.url);
  if (!url) return null;
  const parsed = new URL(url), path = parsed.pathname.split("/").filter(Boolean);
  if (X_HOSTS.has(parsed.hostname)) {
    if (path.length !== 1 || !/^[a-zA-Z0-9_]{1,15}$/.test(path[0]) || X_RESERVED.has(path[0].toLowerCase())) return null;
    return {url, kind:"social", label:`X · @${path[0]}`, key:`x:${path[0].toLowerCase()}`};
  }
  if (["t.me", "telegram.me", "www.t.me"].includes(parsed.hostname)) return {url,kind:"social",label:"Telegram",key:url};
  if (["discord.gg", "discord.com", "www.discord.com"].includes(parsed.hostname)) return {url,kind:"social",label:"Discord",key:url};
  if (parsed.hostname === "github.com" && path.length >= 2) return {url,kind:"github",label:`GitHub · ${path[0]}/${path[1]}`,key:url.replace(/\/$/, "")};
  const kinds = {"x-profile":"social",telegram:"social",discord:"social",website:"website",docs:"docs",github:"github",repository:"github",product:"product",team:"team",about:"about",social:"social"};
  const kind = kinds[link.kind];
  if (!kind) return null;
  const label = kind === "website" ? parsed.hostname.replace(/^www\./, "") : kind === "docs" ? "Documentation" : kind === "team" ? "Team page" : kind === "about" ? "About the project" : text(link.label,80) || parsed.hostname;
  return {url,kind,label,key:url.replace(/\/$/, "")};
}
export function projectEvidence(report = {}) {
  const research = report.research || {}, web = research.webResearch || {};
  const pages = list(web.pages), links = [], facts = [], people = [];
  const seenLinks = new Set(), seenFacts = new Set(), seenPeople = new Set();
  const addLink = (raw, relationship, origin = null) => {
    const info = linkInfo(raw);
    if (!info || seenLinks.has(info.key)) return;
    seenLinks.add(info.key);
    const {key, ...link} = info;
    links.push({...link,relationship,evidenceUrl:evidenceUrl(origin)});
  };
  for (const link of list(research.links)) addLink(link, "Reported project link");
  for (const repo of list(research.repositories)) addLink({...repo,kind:"github"}, "Reported repository");
  for (const page of pages) {
    const origin = evidenceUrl(page.url);
    // Exact-address search hits may still be unrelated. Keep unconfirmed pages
    // in the separate web notes, not among project/team claims.
    if (!origin || !["reported-link", "exact-address"].includes(page.association)) continue;
    for (const link of list(page.extractedLinks)) addLink(link, "Linked from a checked page", origin);
    for (const fact of list(page.facts)) {
      const label = text(fact.label,80), value = text(fact.value), key = `${label}:${value}`;
      if (!label || !value || seenFacts.has(key) || fact.kind !== "page-stated" || evidenceUrl(fact.evidenceUrl) !== origin) continue;
      seenFacts.add(key); facts.push({label,value,evidenceUrl:origin,kind:"page-stated"});
    }
    for (const person of list(page.people)) {
      const name = text(person.name,80), role = text(person.role,80), url = evidenceUrl(person.url), key = `${name}:${url}`;
      if (!name || !role || !url || seenPeople.has(key) || evidenceUrl(person.evidenceUrl) !== origin) continue;
      seenPeople.add(key); people.push({name,role,url,evidenceUrl:origin,context:text(person.context),relationship:"Role stated on checked page"});
    }
  }
  return {links:links.slice(0,32),facts:facts.slice(0,16),people:people.slice(0,12),pagesRead:pages.length,legacy:pages.some(page => !Array.isArray(page.extractedLinks)),checkedAt:web.checkedAt || report.generatedAt || null};
}
