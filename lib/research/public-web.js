// Bounded, free-only public evidence collection. No model, wallet or paid fallback.
import {createReadRequestSignal, throwIfAborted} from "./rpc-sources.js";

const READER = "https://r.jina.ai/";
const SEARCH = "https://api.tavily.com/";
const MAX_BYTES = 512000;

// URLs are sent only to the fixed public reader, never fetched from our server.
// Drop tracking parameters; reject credentials, local targets and recursive proxies.
export function publicWebUrl(raw) {
  if (typeof raw !== "string" || raw.length > 2048 || /[\u0000-\u0020\u007f\\]/.test(raw)) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const host = url.hostname;
    if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) return null;
    if (/(^|\.)(localhost|local|internal|lan|home|test|invalid|example|onion)$/.test(host)) return null;
    if (["r.jina.ai", "s.jina.ai", "api.tavily.com", "metadata.google.internal"].includes(host)) return null;
    if (/(?:^|\.)(?:nip\.io|sslip\.io|localtest\.me|lvh\.me)$/.test(host)) return null;
    // Only known tracking parameters may be dropped. Functional queries and
    // hash-routed apps are skipped rather than silently reading a different page.
    for (const name of url.searchParams.keys()) if (!/^(utm_[a-z_]+|fbclid|gclid)$/i.test(name)) return null;
    if (/^#(?:\/|!)/.test(url.hash)) return null;
    url.search = ""; url.hash = "";
    return url.href;
  } catch { return null; }
}

function plain(value) {
  return typeof value === "string" ? value.replace(/<[^>]*>/g, " ").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() : "";
}
function words(value, max) { return plain(value).split(/\s+/).slice(0, max).join(" ").slice(0, 240); }
export function mentionsAddress(text, address, chain) {
  if (typeof text !== "string" || !address) return false;
  const escaped = address.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-zA-Z0-9])${escaped}(?![a-zA-Z0-9])`, chain === "solana" ? "" : "i").test(text);
}

// Fail closed: even a configured key may belong to a paid or unknown plan.
export function freePlanAllowsSearch(usage, {verifiedFreeAccount = false} = {}) {
  const a = usage?.account, k = usage?.key;
  const integer = n => Number.isSafeInteger(n) && n >= 0;
  // Tavily documents an explicit null key.limit as unlimited, not numeric zero.
  // A null PAYG cap is NOT documented as disabled. Allow it only for a key whose
  // free account billing was separately checked and bound server-side by hash.
  const noPaidAllowance = a?.paygo_limit === 0 || (a?.paygo_limit === null && verifiedFreeAccount === true);
  return !!a && ["free", "researcher"].includes(String(a.current_plan).trim().toLowerCase()) &&
    noPaidAllowance && a.paygo_usage === 0 && integer(a.plan_usage) &&
    integer(a.plan_limit) && a.plan_limit > 0 && a.plan_limit <= 1000 && a.plan_usage + 10 < a.plan_limit &&
    !!k && integer(k.usage) && (k.limit === null || (integer(k.limit) && k.usage < k.limit));
}

export async function verifiedFreeAccountKey(key, fingerprint) {
  if (typeof key !== "string" || !key.trim() || typeof fingerprint !== "string" || !/^[a-f0-9]{64}$/i.test(fingerprint)) return false;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key.trim()));
  const actual = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  return actual === fingerprint.toLowerCase();
}

async function jsonRequest(url, init, options) {
  const request = createReadRequestSignal(options.signal, options.timeoutMs || 10000);
  try {
    const response = await (options.fetchImpl || fetch)(url, {
      ...init, signal: request.signal, redirect: "manual", credentials: "omit", cache: "no-store"
    });
    if (!response.ok) {
      const error = new Error("Public source did not return usable data.");
      error.status = response.status;
      throw error;
    }
    if (Number(response.headers.get("content-length") || 0) > MAX_BYTES) throw new Error("Response too large.");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Empty response.");
    let size = 0; const chunks = [];
    try {
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_BYTES) throw new Error("Response too large.");
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    throwIfAborted(request.signal);
    const data = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder().decode(data));
  } finally { request.dispose(); }
}

function unavailable(error) {
  if ([429, 432, 433].includes(error?.status)) return "The free source limit was reached. No paid fallback was used.";
  if ([401, 402, 403, 451].includes(error?.status)) return "This public source did not allow the request. No restriction was bypassed.";
  if (error?.name === "AbortError" || error?.name === "TimeoutError") return "The public source did not finish within this check’s time limit.";
  return "No usable public content was returned. This stays unverified.";
}

const X_RESERVED = new Set(["home", "explore", "search", "intent", "share", "i", "compose", "settings", "messages", "notifications", "login", "logout", "signup", "tos", "privacy", "hashtag"]);
const NON_PROJECT_HOST = /(?:^|\.)(?:etherscan\.io|basescan\.org|arbiscan\.io|bscscan\.com|polygonscan\.com|solscan\.io|dexscreener\.com|geckoterminal\.com|rugcheck\.xyz|blockscout\.com)$/;
const AUTH_PATH = /(?:^|\/)(?:login|log-in|signin|sign-in|signup|sign-up|oauth|authorize|auth|settings|checkout|payments?|connect-wallet)(?:\/|$)/i;
function cleanPageText(content) {
  return content.slice(0, MAX_BYTES).replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|iframe|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, " ");
}
function linkDetails(raw, label, base) {
  if (typeof raw !== "string" || !raw || raw.startsWith("#") || /[<>\\\u0000-\u0020]/.test(raw)) return null;
  let resolved;
  try { resolved = new URL(raw, base).href; } catch { return null; }
  const safe = publicWebUrl(resolved);
  if (!safe) return null;
  const url = new URL(safe), host = url.hostname.replace(/^www\./, ""), path = url.pathname.replace(/\/$/, "");
  let decodedPath;
  try { decodedPath = decodeURIComponent(path); } catch { return null; }
  if (/[<>\\\u0000-\u0020]/.test(decodedPath) || AUTH_PATH.test(decodedPath) || NON_PROJECT_HOST.test(host)) return null;
  const finish = (kind, description) => ({url: url.href, label: description, kind, relationship: "page-linked"});
  if (["x.com", "twitter.com", "mobile.twitter.com"].includes(host)) {
    const match = path.match(/^\/([A-Za-z0-9_]{1,15})$/);
    if (!match || X_RESERVED.has(match[1].toLowerCase())) return null;
    url.hostname = "x.com"; url.pathname = "/" + match[1].toLowerCase();
    return finish("x-profile", "X profile");
  }
  if (host === "t.me" || host === "telegram.me") {
    if (!/^\/(?:[A-Za-z][A-Za-z0-9_]{4,31}|\+[A-Za-z0-9_-]{8,100}|joinchat\/[A-Za-z0-9_-]{8,100})$/.test(path) || /^\/(?:share|proxy|login|addstickers|addemoji|joinchat|setlanguage|socks)$/i.test(path)) return null;
    url.hostname = "t.me"; url.pathname = path;
    return finish("telegram", "Telegram community");
  }
  if (host === "discord.gg" || host === "discord.com") {
    const match = path.match(host === "discord.gg" ? /^\/([A-Za-z0-9-]{2,100})$/ : /^\/invite\/([A-Za-z0-9-]{2,100})$/);
    if (!match) return null;
    url.hostname = "discord.gg"; url.pathname = "/" + match[1];
    return finish("discord", "Discord community");
  }
  if (host === "github.com") {
    const match = path.match(/^\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9_.-]{1,100})$/);
    if (!match || /^(?:orgs|users|settings|login|features|topics|marketplace|collections|sponsors)$/i.test(match[1])) return null;
    url.pathname = `/${match[1]}/${match[2].replace(/\.git$/i, "")}`.toLowerCase();
    return finish("github", "GitHub repository");
  }
  const clue = `${plain(label)} ${path}`, sameHost = host === new URL(base).hostname.replace(/^www\./, "");
  if (sameHost && /(?:^|[\s/_-])(?:team|people)(?:$|[\s/_-])/i.test(clue)) return finish("team", "Team page");
  if (sameHost && /(?:^|[\s/_-])about(?:$|[\s/_-])/i.test(clue)) return finish("about", "About page");
  if (/(?:^|[\s/_.-])(?:docs?|documentation|whitepaper|white-paper)(?:$|[\s/_.-])/i.test(`${clue} ${host}`)) return finish("docs", "Project documentation");
  if ((sameHost && /(?:^|[\s/_-])(?:app|product|platform|terminal|dashboard)(?:$|[\s/_-])/i.test(clue)) || /^(?:open|launch|try|use) (?:the )?(?:app|product|platform)$/i.test(plain(label))) return finish("product", "Product link");
  return null;
}
function pageLinks(content, base) {
  const found = [], seen = new Set();
  const add = (raw, label, index) => {
    const link = linkDetails(raw, label, base);
    if (!link || seen.has(link.url) || found.length >= 16) return;
    seen.add(link.url); found.push({...link, anchor: plain(label), index});
  };
  for (const match of content.matchAll(/(?<!!)\[([^\]\n]{1,120})\]\(\s*([^\s)]+)(?:\s+"[^"\n]*")?\s*\)/g)) add(match[2], match[1], match.index);
  for (const match of content.matchAll(/https:\/\/[^\s<>"'\])]+/g)) add(match[0].replace(/[.,;:!?]+$/, ""), "", match.index);
  return found;
}
function textLine(value) {
  return plain(value.replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/https?:\/\/\S+/g, " ").replace(/[#*_`|]/g, " "));
}
function structuredDetails(content, base, budget, projectName) {
  const links = pageLinks(content, base), people = [], facts = [];
  const take = (value, maximum, complete = false) => {
    const clean = plain(value), count = clean ? clean.split(/\s+/).length : 0;
    if (!count || !budget.left || (complete && count > Math.min(maximum, budget.left))) return "";
    const result = words(clean, Math.min(maximum, budget.left));
    budget.left -= result.split(/\s+/).length;
    return result;
  };
  // A normal social link is never enough to establish a person or a team role.
  // Only an explicit, short name/role statement on this exact page is captured.
  const role = "(?:co[- ]founder|founder|CEO|CTO|COO|lead developer|lead engineer|community lead|head of research)";
  for (const link of links.filter(item => item.kind === "x-profile" && item.anchor)) {
    if (people.length >= 2) break;
    const start = content.lastIndexOf("\n", link.index) + 1, end = content.indexOf("\n", link.index);
    const line = textLine(content.slice(start, end < 0 ? content.length : end)).replace(/^[-•]\s*/, "");
    const name = link.anchor;
    if (line.length > 160 || !/^[\p{Lu}][\p{L}'’.-]*(?: [\p{Lu}][\p{L}'’.-]*){0,3}$/u.test(name) || /^(?:Team|Founder|Contact|Admin|CEO|CTO|Read|Profile|Twitter|X)$/i.test(name)) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = line.match(new RegExp(`^${escaped}\\s*(?:[,–—:-]|is (?:our|the))\\s*(${role})[.!]?$`, "i")) || line.match(new RegExp(`^(${role})\\s*[:–—-]\\s*${escaped}[.!]?$`, "i"));
    if (!match) continue;
    const statedRole = match[1], needed = `${name} ${statedRole}`.split(/\s+/).length;
    if (needed > budget.left) continue;
    people.push({name: take(name, 4, true), role: take(statedRole, 4, true), url: link.url, evidenceUrl: base, context: ""});
  }
  // Explicit key/value declarations only, not generated claims from prose.
  const declarations = [
    ["Project description", /^(?:description|mission|what we build|product)\s*:\s*(.{8,})$/i, 10],
    ["Launch stated by page", /^(?:launched|launch date)\s*:\s*(.{4,60})$/i, 5],
    ["Founded stated by page", /^(?:founded|established)\s*:\s*(.{4,60})$/i, 5],
    ["Network stated by page", /^(?:network|blockchain|chain)\s*:\s*(.{2,50})$/i, 4],
    ["Project status", /^(?:status|development status)\s*:\s*(.{3,80})$/i, 5],
    ["Licence stated by page", /^(?:licen[cs]e)\s*:\s*(.{2,60})$/i, 5]
  ];
  for (const raw of content.split(/\n+/).slice(0, 2000)) {
    const line = textLine(raw).replace(/^[-•]\s*/, "");
    if (line.length > 200 || /cookie|privacy policy|sign (?:up|in)|log in/i.test(line)) continue;
    for (const [label, pattern, max] of declarations) {
      const match = line.match(pattern);
      if (!match || facts.some(fact => fact.label === label) || facts.length >= 3) continue;
      // Preserve whole values: truncating a negation/date can reverse meaning.
      const value = take(match[1], max, true);
      if (value) facts.push({label, value, evidenceUrl: base, kind: "page-stated"});
    }
  }
  if (!facts.some(fact => fact.label === "Project description") && facts.length < 3) {
    // A short complete self-description can be useful even without a label.
    // Do not chop longer prose into an apparently complete factual statement.
    for (const raw of content.split(/\n+/).slice(0, 2000)) {
      const line = textLine(raw);
      const escapedName = typeof projectName === "string" && /^[\p{L}\p{N}][\p{L}\p{N} '&’.-]{1,59}$/u.test(projectName) ? projectName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : null;
      const namedClaim = escapedName ? new RegExp(`^${escapedName} (?:is|builds|provides|offers|turns|enables|connects|helps)\\b[^.!?]{8,150}[.!?](?:\\s|$)`, "i") : null;
      const claim = (line.match(/^(?:We (?:build|develop|provide|offer)|Our (?:project|platform|product) (?:is|builds|provides|offers))\b[^.!?]{8,150}[.!?](?:\s|$)/i) || (namedClaim && line.match(namedClaim)))?.[0]?.trim();
      if (!claim) continue;
      const value = take(claim, 14, true);
      if (value) facts.push({label: "Project description", value, evidenceUrl: base, kind: "page-stated"});
      break;
    }
  }
  return {people, facts, extractedLinks: links.map(({anchor, index, ...link}) => link)};
}

function pageEvidence(candidate, title, content, target, checkedAt) {
  content = cleanPageText(content);
  const addressMentioned = mentionsAddress(content, target.address, target.chain);
  const observations = [addressMentioned
    ? "The exact token address appears in the returned text. This alone does not authenticate the author or the network."
    : "The exact token address was not found in the returned text. This page’s connection to the token is not confirmed."];
  const associations = [
    ["github.com", "A GitHub link appears in the returned text; code ownership and quality are not verified."],
    ["x.com", "An X link appears in the returned text; followers and engagement have not been measured."],
    ["t.me", "A Telegram link appears in the returned text; group activity has not been verified."],
    ["discord.com", "A Discord link appears in the returned text; community activity has not been verified."]
  ];
  for (const [host, note] of associations) {
    if (new RegExp(`https:\\/\\/(?:www\\.)?${host.replaceAll(".", "\\.")}\\/`, "i").test(content)) observations.push(note);
  }
  // A single budget covers all copied words, including names, roles and facts.
  // Link labels and observations are generated, never copied anchor text.
  const pageTitle = words(title, 6) || new URL(candidate.url).hostname;
  const budget = {left: 25 - pageTitle.split(/\s+/).length};
  const details = structuredDetails(content, candidate.url, budget, candidate.projectName);
  const paragraphs = content.split(/\n+/).map(textLine).filter(text => text.length >= 60 && !/cookie|all rights reserved|privacy policy|terms of (?:use|service)|sign (?:up|in)|log in|subscribe|skip to|navigation/i.test(text));
  const excerptText = paragraphs.find(text => mentionsAddress(text, target.address, target.chain)) ||
    paragraphs.find(text => /\b(?:project|network|platform|protocol|develop|build|blockchain|application)\b/i.test(text)) || paragraphs[0] || "";
  return {
    url: candidate.url, title: pageTitle,
    kind: candidate.kind, discoveredVia: candidate.discoveredVia,
    association: addressMentioned ? "exact-address" : candidate.kind === "search-result" ? "unconfirmed" : "reported-link",
    addressMentioned, checkedAt, publishedAt: null, observations,
    ...details, excerpt: details.facts.length || details.people.length ? "" : words(excerptText, Math.min(15, budget.left))
  };
}

async function searchExactAddress(target, options) {
  const checkedAt = new Date().toISOString();
  const base = {provider: "Tavily", checkedAt};
  if (options.disabledSources?.includes("websearch")) return {search: {...base, status: "paused", message: "Web search is paused by the owner."}, candidates: []};
  if (!options.tavilyKey) return {search: {...base, status: "not_configured", message: "Automatic web search needs the owner’s free account connection. Public-page checks can still run."}, candidates: []};
  try {
    const headers = {Accept: "application/json", Authorization: `Bearer ${options.tavilyKey}`};
    const usage = await jsonRequest(SEARCH + "usage", {headers}, options);
    const verifiedFreeAccount = await verifiedFreeAccountKey(options.tavilyKey, options.freeOnlyKeySha256);
    if (!freePlanAllowsSearch(usage, {verifiedFreeAccount})) return {search: {...base, status: "limited", message: "Search was stopped: an eligible free plan with paid overages disabled and spare credits could not be confirmed."}, candidates: []};
    if (!options.reserveSearch || !await options.reserveSearch()) return {search: {...base, status: "limited", message: "The site’s free search allowance is unavailable or exhausted. No paid fallback was used."}, candidates: []};
    throwIfAborted(options.signal);
    const data = await jsonRequest(SEARCH + "search", {method: "POST", headers: {...headers, "Content-Type": "application/json"}, body: JSON.stringify({
      query: `"${target.address}"`, search_depth: "basic", topic: "general", max_results: 5,
      auto_parameters: false, include_answer: false, include_raw_content: false, include_images: false, include_usage: true
    })}, options);
    if (!Array.isArray(data?.results)) throw new Error("Malformed search response.");
    // A search hit is a lead, never verification. Require the full address in the
    // returned text/URL; a copied token name is insufficient for inclusion.
    const candidates = [];
    for (const result of data.results.slice(0, 5)) {
      const url = publicWebUrl(result?.url);
      if (!url || !mentionsAddress(`${result.title || ""} ${result.content || ""} ${url}`, target.address, target.chain)) continue;
      if (!candidates.some(c => c.url === url)) candidates.push({url, kind: "search-result", discoveredVia: "Tavily exact-address search"});
    }
    return {search: {...base, status: "available", message: `${candidates.length} exact-address search lead(s) found. Only pages actually read below contribute evidence notes.`}, candidates};
  } catch (error) {
    throwIfAborted(options.signal);
    return {search: {...base, status: "error", message: unavailable(error)}, candidates: []};
  }
}

async function readCandidate(candidate, target, options) {
  const check = {name: "Public page", url: candidate.url, provider: "Jina Reader · key-free", checkedAt: new Date().toISOString(), ok: false};
  try {
    // No API key, cookies, proxy override, generated summaries, or custom script.
    const data = await jsonRequest(READER + candidate.url, {headers: {
      Accept: "application/json", "X-Engine": "direct", "X-Timeout": "8",
      "X-Robots-Txt": "*", DNT: "1", "X-Retain-Images": "none"
    }}, options);
    const page = data?.data;
    const source = publicWebUrl(page?.url);
    const host = url => new URL(url).hostname.replace(/^www\./, "");
    if (data?.code !== 200 || page?.httpStatus < 200 || page?.httpStatus >= 300 ||
      !Number.isInteger(page?.httpStatus) || !source || host(source) !== host(candidate.url) ||
      typeof page?.content !== "string" || plain(page.content).length < 80 ||
      /^(just a moment|access denied|sign in|log in|error\b|robot check)/i.test(plain(page.title))) throw new Error("No readable matching page.");
    check.checkedAt = new Date().toISOString();
    return {check: {...check, url: source, ok: true, message: "Public text received. Content and project association are not independently verified; upstream cache age is unknown."}, page: pageEvidence({...candidate, url: source}, page.title, page.content, target, check.checkedAt)};
  } catch (error) {
    throwIfAborted(options.signal);
    return {check: {...check, message: unavailable(error)}, page: null};
  }
}

export async function collectPublicWeb(report, options = {}) {
  throwIfAborted(options.signal);
  const {search, candidates: discovered} = await searchExactAddress(report.target, options);
  const reported = (report.research?.links || []).filter(link => ["website", "docs", "social"].includes(link.kind))
    .map(link => ({url: publicWebUrl(link.url), kind: link.kind, discoveredVia: link.source || "Reported project link"})).filter(link => link.url);
  // Four total attempts, at most two reader requests at once, and one follow-up
  // wave. The latter follows only links observed in successfully read pages;
  // it cannot recurse, guess a project name or silently consume more searches.
  const eligible = candidate => candidate?.url && !NON_PROJECT_HOST.test(new URL(candidate.url).hostname);
  const unique = list => [...new Map(list.filter(eligible).map(link => [link.url, link])).values()];
  const ordered = unique([reported.find(link => link.kind === "website"), reported.find(link => link.kind === "social"), ...reported, ...discovered]);
  const attempted = new Set(), results = [];
  const readWave = async candidates => {
    await Promise.all(candidates.map(async candidate => {
      const order = attempted.size;
      attempted.add(candidate.url);
      try { results.push({...await readCandidate({...candidate, projectName:report.identity?.name}, report.target, options), order}); }
      catch (error) {
        // Preserve already-received pages if this bounded enrichment times out.
        // Cancellation before any work still rejects at the entry point above.
        results.push({order, page: null, check: {name: "Public page", url: candidate.url, provider: "Jina Reader · key-free", checkedAt: new Date().toISOString(), ok: false, message: unavailable(error)}});
      }
    }));
  };
  if (!options.disabledSources?.includes("publicweb")) {
    await readWave(ordered.slice(0, 2));
    const followups = results.flatMap(result => {
      if (!result.page || !["website", "docs"].includes(result.page.kind)) return [];
      const host = new URL(result.page.url).hostname.replace(/^www\./, "");
      return result.page.extractedLinks.filter(link => ["team", "about", "docs"].includes(link.kind) && new URL(link.url).hostname.replace(/^www\./, "") === host)
        .sort((a, b) => ["team", "about", "docs"].indexOf(a.kind) - ["team", "about", "docs"].indexOf(b.kind))
        .map(link => ({url: link.url, kind: link.kind === "docs" ? "docs" : "website", discoveredVia: "Link on a retrieved project page"}));
    });
    if (!options.signal?.aborted) await readWave(unique([...followups, ...discovered, ...ordered]).filter(link => !attempted.has(link.url)).slice(0, Math.min(2, 4 - attempted.size)));
  }
  // Promise completion order must not change the report's evidence order.
  results.sort((a, b) => a.order - b.order);
  const pages = results.flatMap(result => result.page ? [result.page] : []).map((page, i) => ({id: `web-${i + 1}`, ...page}));
  const checks = results.map(result => result.check);
  const summary = pages.length
    ? [`Read ${pages.length} public page(s) and prepared limited evidence notes.`, `${pages.filter(page => page.addressMentioned).length} returned page(s) mention the exact token address; this does not establish official ownership.`]
    : [options.disabledSources?.includes("publicweb") ? "Public-page reading is paused by the owner." : ordered.length ? "The selected public pages could not be read. No page-content conclusions were made." : "No eligible public page was discovered for this check. Website and social content remain unknown."];
  return {
    version: 1, mode: "free-only", checkedAt: new Date().toISOString(), status: pages.length ? "partial" : "unavailable",
    search, pages, checks, summary,
    limitations: [
      "These are rule-based evidence notes, not a full AI investigation, code audit or fact-check of every claim.",
      "At most four public pages are attempted, including one bounded follow-up wave. Login-only content, private groups, audience authenticity and complete social histories are not covered.",
      "Extracted links, project declarations and explicitly listed team roles are page-stated evidence, not authenticated ownership, working products or verified affiliations.",
      "A matching address can be copied onto an unrelated page. Reported links and search hits do not prove affiliation, network identity or safety.",
      "Page publication dates and upstream cache age are not verified. A fetched timestamp is not a project creation date."
    ]
  };
}
