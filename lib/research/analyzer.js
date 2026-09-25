import { rpcWithSources, createReadRequestSignal, throwIfAborted } from "./rpc-sources.js";
import { RESEARCH_CHAINS, chainFromUrl, safeResearchUrl, explorerLink, buildResearchReport } from "./research-report.js";
import { collectBuyerActivity } from "./buyer-activity.js";

const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const RUGCHECK_BASE = "https://api.rugcheck.xyz/v1/tokens";
const DEXSCREENER_BASE = "https://api.dexscreener.com/tokens/v1";
const GECKO_BASE = "https://api.geckoterminal.com/api/v2/networks";
const GOPLUS_BASE = "https://api.gopluslabs.io/api/v1/token_security";

const BURN_ADDRESSES = new Set([
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dead"
]);

const TIER_RANK = { UNKNOWN: 0, YELLOW: 1, AMBER: 2, RED: 3, REJECT: 4 };

function trimCandidate(value) {
  return String(value || "")
    .trim()
    .replace(/[?#].*$/, "")
    .replace(/[),.;\]}>'\"]+$/, "");
}

export function parseTarget(input, fallbackUrl = "") {
  const raw = String(input || fallbackUrl || "").trim();
  if (!raw) return null;

  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // Keep the original string if it is not valid percent-encoded text.
  }

  let candidate = trimCandidate(decoded);
  let hintedChain = null;
  try {
    const parsed = new URL(decoded);
    if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password) return null;
    // A chart pool address is not necessarily the token address. Accept only
    // explicit token/address URL paths, never query-string or hostname matches.
    const segments = parsed.pathname.split("/").filter(Boolean);
    const markerIndex = segments.findIndex((part) =>
      ["coin", "token", "address", "mint"].includes(part.toLowerCase())
    );
    if (markerIndex >= 0 && segments[markerIndex + 1]) {
      candidate = trimCandidate(segments[markerIndex + 1]);
    } else return null;
    hintedChain = chainFromUrl(decoded);
  } catch {
    // A bare address is accepted, but arbitrary prose or long substrings are not.
  }
  if (EVM_ADDRESS.test(candidate)) return { address: candidate, chain: hintedChain || "auto", platform: detectPlatform(decoded), input: raw };
  if (!SOLANA_ADDRESS.test(candidate) || (hintedChain && hintedChain !== "solana")) return null;
  return {
    address: candidate,
    chain: "solana",
    platform: detectPlatform(decoded),
    input: raw
  };
}

function detectPlatform(value) {
  let host;
  try { host = new URL(value).hostname; } catch { return "Direct address"; }
  if (host === "pump.fun" || host === "www.pump.fun") return "pump.fun (input link; origin unverified)";
  if (["stonkfun.com", "stonk.fun"].includes(host)) return "StonkFun (input link; origin unverified)";
  if (host.endsWith(".blockscout.com")) return "Blockscout";
  return "Direct address";
}

function finding(severity, code, title, detail, category, hardFail = false) {
  return { severity, code, title, detail, category, hardFail };
}

async function fetchJson(url, options = {}, timeoutMs = 12000, fetchImpl = fetch) {
  const request = createReadRequestSignal(options.signal, timeoutMs);
  try {
    const response = await fetchImpl(url, {
      ...options,
      cache: "no-store",
      credentials: "omit",
      signal: request.signal,
      headers: {
        Accept: "application/json",
        ...(options.headers || {})
      }
    });
    throwIfAborted(request.signal);
    if (!response.ok) throw new Error([401, 403].includes(response.status)
      ? "This source is not accepting public requests right now. Other available sources were checked."
      : response.status === 429 ? "This source is busy. Try refreshing later."
      : response.status === 404 ? "This source has not indexed this exact token yet."
      : "This source could not complete the check. Try refreshing later.");
    const data = await response.json();
    throwIfAborted(request.signal);
    return data;
  } finally {
    request.dispose();
  }
}

async function attempt(name, task, { provider = name, validate = hasData, signal, url = null, snapshot = false } = {}) {
  try {
    throwIfAborted(signal);
    const data = await task();
    throwIfAborted(signal);
    if (!validate(data)) throw new Error("No usable, matching data was returned for this check.");
    return { name, ok: true, data, provider, url, snapshot, checkedAt: new Date().toISOString() };
  } catch (error) {
    throwIfAborted(signal);
    return {
      name,
      ok: false,
      provider,
      url,
      checkedAt: new Date().toISOString(),
      error: error?.name === "AbortError" ? "The source did not respond in time. Try refreshing later." : safeSourceError(error)
    };
  }
}

function safeSourceError(error) {
  const message = String(error?.message || "");
  // Only our plain explanations are displayed; fetch errors can contain private endpoint URLs.
  return /^(This source|No usable|The source|Could not verify)/.test(message)
    ? message : "The source could not complete this check. Try refreshing later.";
}

function hasData(data) {
  return data != null && typeof data === "object" && Object.keys(data).length > 0;
}

async function attemptRpc(name, method, params, options, validate) {
  try {
    return { name, ok: true, ...await rpcWithSources(method, params, {
      rpcUrl: options.solanaRpcUrl, fetchImpl: options.fetchImpl, timeoutMs: options.timeoutMs, validate, signal: options.signal
    }) };
  } catch (error) {
    throwIfAborted(options.signal);
    return { name, ok: false, checkedAt: error.checkedAt || new Date().toISOString(),
      attempts: error.attempts || [], error: safeSourceError(error) };
  }
}

function toFiniteNumber(value) {
  if (value == null || value === "" || typeof value === "boolean") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function integerPercentage(value, total) {
  try {
    const numerator = BigInt(String(value || "0"));
    const denominator = BigInt(String(total || "0"));
    if (denominator === 0n) return null;
    return Number((numerator * 1_000_000n) / denominator) / 10_000;
  } catch {
    return null;
  }
}

function normalizeAddress(entry) {
  const candidate = entry?.address_hash || entry?.address || entry;
  if (typeof candidate === "string") return candidate;
  return candidate?.hash || "";
}

function holderLabel(entry) {
  const address = entry?.address_hash || entry?.address || {};
  const tags = [
    address?.name,
    address?.metadata?.name,
    ...(address?.public_tags || []).map((tag) => tag.display_name || tag.label),
    ...(address?.watchlist_names || []).map((tag) => tag.display_name || tag.label)
  ].filter(Boolean);
  return tags.join(" · ");
}

export function isProtocolHolder(entry) {
  const address = normalizeAddress(entry).toLowerCase();
  const label = holderLabel(entry).toLowerCase();
  if (BURN_ADDRESSES.has(address)) return true;
  return /(pool|pair|router|locker|lock|curve|settler|launch|escrow|vault|burn|null)/i.test(label);
}

function pickDexPair(pairs, address, chain) {
  const matches = (value) => chain === "solana" ? value === address : String(value || "").toLowerCase() === address.toLowerCase();
  return [...(Array.isArray(pairs) ? pairs : [])]
    .filter((pair) => {
      // DEX Screener's price, cap and changes describe the BASE token, not the quote.
      return pair?.chainId === chain && matches(pair?.baseToken?.address);
    })
    .sort((a, b) => Number(b?.liquidity?.usd || 0) - Number(a?.liquidity?.usd || 0))[0] || null;
}

async function scanDex(address, chain, options = {}) {
  const data = options.dexData || await fetchJson(`${DEXSCREENER_BASE}/${chain}/${address}`, { signal: options.signal }, options.timeoutMs, options.fetchImpl);
  const pair = pickDexPair(Array.isArray(data) ? data : data?.pairs, address, chain);
  if (!pair) return null;
  if (![pair.priceUsd, pair.marketCap, pair.liquidity?.usd, pair.volume?.h1, pair.volume?.h24].some((value) => toFiniteNumber(value) != null)) return null;
  return {
    provider: "DEX Screener",
    pairAddress: pair.pairAddress,
    dexId: pair.dexId,
    chainId: pair.chainId,
    url: safeProjectUrl(pair.url),
    priceUsd: toFiniteNumber(pair.priceUsd),
    marketCap: toFiniteNumber(pair.marketCap),
    fdv: toFiniteNumber(pair.fdv),
    liquidityUsd: toFiniteNumber(pair?.liquidity?.usd),
    pairCreatedAt: pair.pairCreatedAt || null,
    volume: pair.volume || {},
    txns: pair.txns || {},
    priceChange: pair.priceChange || {},
    activeBoosts: toFiniteNumber(pair.boosts?.active),
    baseToken: pair.baseToken || null,
    quoteToken: pair.quoteToken || null,
    websites: sanitizeLinks(pair?.info?.websites, "DEX Screener", "Website"),
    socials: sanitizeLinks(pair?.info?.socials, "DEX Screener", "Social")
  };
}

function safeProjectUrl(value) {
  return safeResearchUrl(value);
}

async function scanGecko(target, options) {
  const network = RESEARCH_CHAINS[target.chain]?.gecko;
  if (!network) throw new Error("This source does not have a configured network for the selected chain.");
  const url = `${GECKO_BASE}/${network}/tokens/${target.address}/pools?include=base_token,quote_token`;
  const response = await fetchJson(url, { signal: options.signal }, options.timeoutMs, options.fetchImpl);
  const same = (address) => target.chain === "solana" ? address === target.address : String(address).toLowerCase() === target.address.toLowerCase();
  // Gecko's volume, changes and transactions are pool statistics; use BASE only
  // to avoid interpreting the quote side's buys/sells as target-token buys/sells.
  const pools = (Array.isArray(response?.data) ? response.data : []).filter((pool) => {
    const tokenId = pool?.relationships?.base_token?.data?.id;
    if (!String(tokenId || "").startsWith(`${network}_`)) return false;
    const poolId = String(pool.id || "");
    return poolId.startsWith(`${network}_`) && same(tokenId.slice(network.length + 1));
  }).sort((a, b) => Number(b.attributes?.reserve_in_usd || 0) - Number(a.attributes?.reserve_in_usd || 0));
  const pool = pools[0], attrs = pool?.attributes;
  if (!attrs || ![attrs.base_token_price_usd, attrs.reserve_in_usd, attrs.volume_usd?.h24].some((value) => toFiniteNumber(value) != null)) return null;
  const includedToken = (response.included || []).find((item) => item.id === pool.relationships.base_token.data.id && same(item.attributes?.address));
  return {
    provider: "GeckoTerminal", pairAddress: attrs.address || null, dexId: pool.relationships?.dex?.data?.id || null,
    chainId: target.chain, url: safeProjectUrl(`https://www.geckoterminal.com/${network}/pools/${attrs.address || pool.id.slice(network.length + 1)}`),
    priceUsd: toFiniteNumber(attrs.base_token_price_usd), marketCap: toFiniteNumber(attrs.market_cap_usd), fdv: toFiniteNumber(attrs.fdv_usd),
    liquidityUsd: toFiniteNumber(attrs.reserve_in_usd), pairCreatedAt: attrs.pool_created_at ? Date.parse(attrs.pool_created_at) || null : null,
    volume: attrs.volume_usd || {}, txns: attrs.transactions || {}, priceChange: attrs.price_change_percentage || {},
    baseToken: { address: target.address, name: includedToken?.attributes?.name || null, symbol: includedToken?.attributes?.symbol || null },
    websites: [], socials: [], fetchedAt: new Date().toISOString(), upstreamUpdatedAt: null
  };
}

async function scanGeckoMetadata(target, options) {
  const network = RESEARCH_CHAINS[target.chain]?.gecko;
  if (!network) throw new Error("This source does not have a configured network for the selected chain.");
  const data = await fetchJson(`${GECKO_BASE}/${network}/tokens/${target.address}/info`, { signal: options.signal }, options.timeoutMs, options.fetchImpl);
  const attrs = data?.data?.attributes;
  const same = target.chain === "solana" ? attrs?.address === target.address : String(attrs?.address || "").toLowerCase() === target.address.toLowerCase();
  if (!same || data?.data?.id !== `${network}_${target.chain === "solana" ? target.address : target.address.toLowerCase()}`) return null;
  const socialHandle = (host, handle) => typeof handle === "string" && /^[a-zA-Z0-9_]{1,64}$/.test(handle) ? `https://${host}/${handle}` : null;
  return {
    websites: sanitizeLinks(attrs.websites, "GeckoTerminal metadata", "Website"),
    socials: sanitizeLinks([
      { type: "twitter", url: socialHandle("x.com", attrs.twitter_handle) },
      { type: "telegram", url: socialHandle("t.me", attrs.telegram_handle) },
      { type: "discord", url: attrs.discord_url },
      ...(Array.isArray(attrs.github_repos) ? attrs.github_repos.map((url) => ({ type: "github", url })) : [])
    ], "GeckoTerminal metadata", "Social"),
    description: typeof attrs.description === "string" ? attrs.description.slice(0, 3000) : null,
    updatedAt: typeof attrs.gt_updated_at === "string" && Number.isFinite(Date.parse(attrs.gt_updated_at)) ? attrs.gt_updated_at : null,
    holderCount: Number.isSafeInteger(attrs.holders?.count) && attrs.holders.count >= 0 ? attrs.holders.count : null,
    holdersUpdatedAt: typeof attrs.holders?.last_updated === "string" && Number.isFinite(Date.parse(attrs.holders.last_updated)) ? attrs.holders.last_updated : null,
    top10HolderPct: toFiniteNumber(attrs.holders?.distribution_percentage?.top_10),
    developerAddress: target.chain === "solana" ? SOLANA_ADDRESS.test(attrs.developer_address || "") ? attrs.developer_address : null : EVM_ADDRESS.test(attrs.developer_address || "") ? attrs.developer_address : null,
    developerHoldingsPct: toFiniteNumber(attrs.developer_holding_percentage)
  };
}

function geckoChecks(target, options) {
  return [
    attempt("GeckoTerminal market", () => scanGecko(target, options), { provider: "api.geckoterminal.com", signal: options.signal, url: "https://www.geckoterminal.com/" }),
    attempt("GeckoTerminal metadata", () => scanGeckoMetadata(target, options), { provider: "api.geckoterminal.com", signal: options.signal, url: "https://www.geckoterminal.com/" })
  ];
}

function selectMarket(dexResult, geckoResult, findings) {
  const dex = dexResult.ok ? dexResult.data : null, gecko = geckoResult.ok ? geckoResult.data : null;
  if (dex && gecko && dex.priceUsd > 0 && gecko.priceUsd > 0) {
    const difference = Math.abs(dex.priceUsd - gecko.priceUsd) / Math.max(dex.priceUsd, gecko.priceUsd) * 100;
    if (difference > 15) findings.push(finding("warn", "MARKET_SOURCE_DISAGREEMENT", "Market sources disagree", `The indexed token prices differ by about ${difference.toFixed(1)}%. Different pools or indexing delays may explain this; check both charts.`, "Market"));
  }
  return dex || gecko;
}

function supplementMetadata(metrics, metadataResult) {
  if (!metadataResult.ok) return;
  const data = metadataResult.data;
  recordHolderCount(metrics, data.holderCount, "GeckoTerminal metadata", data.holdersUpdatedAt);
  metrics.reportedDeveloperAddress = data.developerAddress;
  if (metrics.developerHoldingsPct == null && data.developerHoldingsPct != null && data.developerHoldingsPct >= 0 && data.developerHoldingsPct <= 100) metrics.developerHoldingsPct = data.developerHoldingsPct;
  if (data.top10HolderPct != null && data.top10HolderPct >= 0 && data.top10HolderPct <= 100) metrics.metadataTop10Pct = data.top10HolderPct;
}

function recordHolderCount(metrics, raw, source, upstreamUpdatedAt = null) {
  const count = toFiniteNumber(raw);
  if (!Number.isSafeInteger(count) || count < 0) return;
  metrics.holderCountObservations ||= [];
  metrics.holderCountObservations.push({ count, source, upstreamUpdatedAt, fetchedAt: new Date().toISOString() });
  if (metrics.holders == null) {
    metrics.holders = count;
    metrics.holdersSource = source;
    metrics.holdersUpdatedAt = upstreamUpdatedAt;
  }
}

function reconcileHolderCounts(metrics, findings) {
  const observations = metrics.holderCountObservations || [];
  const zero = observations.some((item) => item.count === 0);
  const positive = observations.some((item) => item.count > 0) || [...(metrics.topHolders || []), ...(metrics.rawTopHolders || [])].some((holder) => holder.percentage > 0);
  if (zero && positive) {
    metrics.holders = null;
    metrics.holdersSource = "Conflicting source snapshots";
    metrics.holdersUpdatedAt = null;
    metrics.holdersNote = "One source reports zero holders while another source or balance snapshot reports holders. The true total is not established; individual provider counts are shown with their provenance.";
    findings.push(finding("unknown", "HOLDER_COUNT_CONFLICT", "Holder totals conflict", metrics.holdersNote, "Distribution"));
  } else if (new Set(observations.map((item) => item.count)).size > 1) {
    metrics.holdersNote = "Providers report different holder totals. The displayed count uses the named source; snapshots may differ in age or counting methodology.";
    findings.push(finding("info", "HOLDER_COUNT_VARIANCE", "Holder counts differ by source", metrics.holdersNote, "Distribution"));
  } else if (observations.length) {
    metrics.holdersNote = "Provider-reported holder count; underlying age is unknown unless a source update time is supplied.";
  }
}

function sanitizeLinks(entries, source, fallbackLabel) {
  return (Array.isArray(entries) ? entries : []).slice(0, 20).flatMap((entry) => {
    const url = safeProjectUrl(typeof entry === "string" ? entry : entry?.url);
    if (!url) return [];
    const label = String(entry?.label || entry?.type || fallbackLabel).slice(0, 80);
    return [{ url, label, type: String(entry?.type || "").slice(0, 40), source, verified: false }];
  });
}

function rugProjectLinks(report) {
  if (!report) return { websites: [], socials: [] };
  const metadata = report.fileMeta || {};
  const tokenMeta = report.tokenMeta || {};
  const extension = metadata.extensions || {};
  return {
    websites: sanitizeLinks([metadata.website, metadata.external_url, tokenMeta.website, extension.website], "RugCheck metadata", "Website"),
    socials: sanitizeLinks([
      ...[metadata, tokenMeta, extension].flatMap((item) => ["twitter", "telegram", "discord", "github", "docs", "whitepaper"].map((type) => ({ type, url: item[type] })))
    ], "RugCheck metadata", "Social")
  };
}

function analyzeDex(dex, findings, metrics) {
  if (!dex) {
    findings.push(finding("unknown", "DEX_NOT_INDEXED", "Market not indexed", "No liquid market was returned by the market-data source.", "Market"));
    return;
  }

  metrics.priceUsd = dex.priceUsd;
  metrics.marketCap = dex.marketCap;
  metrics.fdv = dex.fdv;
  metrics.liquidityUsd = dex.liquidityUsd;
  metrics.volume24h = toFiniteNumber(dex?.volume?.h24);
  metrics.volume1h = toFiniteNumber(dex?.volume?.h1);
  metrics.priceChange1h = toFiniteNumber(dex?.priceChange?.h1);
  metrics.buys1h = toFiniteNumber(dex?.txns?.h1?.buys);
  metrics.sells1h = toFiniteNumber(dex?.txns?.h1?.sells);
  metrics.pairCreatedAt = dex.pairCreatedAt;
  metrics.activeBoosts = dex.activeBoosts ?? null;
  if (dex.activeBoosts > 0) findings.push(finding("info", "PAID_BOOSTS", "Paid visibility boost is active", `${dex.activeBoosts} active boost(s) are reported by DEX Screener. Paid exposure is not proof of organic demand.`, "Authenticity"));

  if (dex.liquidityUsd == null) {
    findings.push(finding("unknown", "LIQUIDITY_UNKNOWN", "Liquidity unavailable", "The market-data source did not report dollar liquidity.", "Liquidity"));
  } else if (dex.liquidityUsd < 1_000) {
    findings.push(finding("danger", "LIQUIDITY_CRITICAL", "Extremely thin liquidity", `Only about $${Math.round(dex.liquidityUsd).toLocaleString()} of liquidity is visible. Exits can become impossible or extremely expensive.`, "Liquidity", true));
  } else if (dex.liquidityUsd < 10_000) {
    findings.push(finding("warn", "LIQUIDITY_LOW", "Low liquidity", `About $${Math.round(dex.liquidityUsd).toLocaleString()} of liquidity is visible.`, "Liquidity"));
  } else {
    findings.push(finding("good", "LIQUIDITY_VISIBLE", "Liquidity is visible", `Approximately $${Math.round(dex.liquidityUsd).toLocaleString()} is reported in the strongest indexed pool.`, "Liquidity"));
  }

  const buys = metrics.buys1h;
  const sells = metrics.sells1h;
  if (buys != null && sells != null && buys + sells >= 20) {
    if (sells === 0 && buys >= 20) {
      findings.push(finding("warn", "NO_SELL_FLOW", "No sells in recent indexed flow", "This can be innocent during a new launch, but it can also indicate exit restrictions. Confirm with a sell simulation.", "Market"));
    } else {
      findings.push(finding("info", "FLOW_VISIBLE", "Recent buy/sell flow available", `${buys.toLocaleString()} buys and ${sells.toLocaleString()} sells were indexed over one hour.`, "Market"));
    }
  }
}

function analyzeProjectLinks(dex, findings, identity, rugReport = null, geckoMetadata = null) {
  const extra = rugProjectLinks(rugReport);
  const unique = (items) => [...new Map(items.map((item) => [item.url, item])).values()];
  const websites = unique([...(dex?.websites || []), ...extra.websites, ...(geckoMetadata?.websites || [])]);
  const socials = unique([...(dex?.socials || []), ...extra.socials, ...(geckoMetadata?.socials || [])]);
  identity.websites = websites;
  identity.socials = socials;
  identity.description = geckoMetadata?.description || null;
  identity.descriptionSource = geckoMetadata?.description ? "GeckoTerminal metadata — project claims, not verified" : null;
  if (!websites.length && !socials.length) {
    findings.push(finding("warn", "NO_PROJECT_LINKS", "No indexed project links", "The checked market and metadata sources did not return usable website or social links. This is not proof that none exist.", "Authenticity"));
  } else {
    findings.push(finding("info", "PROJECT_LINKS_INDEXED", "Project links are indexed", `${websites.length} website link(s) and ${socials.length} social link(s) were returned. Their presence does not verify the claims or team.`, "Authenticity"));
  }
}

function analyzeSolanaRugCheck(report, findings, metrics, identity) {
  if (!report) return;
  identity.creator = SOLANA_ADDRESS.test(report.creator || "") ? report.creator : null;
  identity.creatorSource = identity.creator ? "RugCheck creator field" : null;
  identity.updateAuthority = SOLANA_ADDRESS.test(report?.tokenMeta?.updateAuthority || "") ? report.tokenMeta.updateAuthority : null;
  metrics.rugCheckScore = toFiniteNumber(report.score_normalised ?? report.score);
  metrics.insiderPercentage = toFiniteNumber(report.totalInsiderPercentage);
  metrics.holders = null;
  recordHolderCount(metrics, report.totalHolders, "RugCheck report");
  metrics.rugged = typeof report.rugged === "boolean" ? report.rugged : null;

  if (metrics.rugged) {
    findings.push(finding("danger", "RUGCHECK_RUGGED", "Token is marked rugged", "RugCheck's current report marks this mint as rugged.", "On-chain risk", true));
  }

  const risks = Array.isArray(report.risks) ? report.risks : [];
  for (const risk of risks.slice(0, 12)) {
    const level = String(risk?.level || "warn").toLowerCase();
    const title = risk?.name || "RugCheck signal";
    const detail = risk?.description || String(risk?.value || "Risk signal returned by RugCheck.");
    const severe = ["danger", "critical"].includes(level);
    const hard = /honeypot|cannot sell|freeze authority|mint authority|creator history of rugged|history of rugging/i.test(`${title} ${detail}`);
    findings.push(finding(severe ? "danger" : "warn", `RUGCHECK_${slug(title)}`, title, detail, "On-chain risk", hard));
  }

  if (!risks.length && !metrics.rugged) {
    findings.push(finding("good", "RUGCHECK_NO_LISTED_RISKS", "No RugCheck warnings returned", "This is a useful signal, not a guarantee that the creator or market is safe.", "On-chain risk"));
  }

  const insiderNetworks = Array.isArray(report.insiderNetworks) ? report.insiderNetworks.length : Number(report.totalInsiderNetworks || 0);
  if (report.graphInsidersDetected === true || insiderNetworks > 0) {
    findings.push(finding("danger", "INSIDER_GRAPH", "Linked insider network detected", `RugCheck reported ${insiderNetworks || "one or more"} insider network(s).`, "Distribution"));
  }

  if (metrics.insiderPercentage != null && metrics.insiderPercentage > 15) {
    findings.push(finding("danger", "INSIDER_SUPPLY_HIGH", "High insider concentration", `Approximately ${metrics.insiderPercentage.toFixed(2)}% is attributed to insiders.`, "Distribution", true));
  } else if (metrics.insiderPercentage != null && metrics.insiderPercentage > 5) {
    findings.push(finding("warn", "INSIDER_SUPPLY_ELEVATED", "Elevated insider concentration", `Approximately ${metrics.insiderPercentage.toFixed(2)}% is attributed to insiders.`, "Distribution"));
  }

  const marketOwners = new Set(
    (Array.isArray(report.markets) ? report.markets : []).flatMap((market) => [market?.pubkey, market?.liquidityA, market?.liquidityB]).filter(Boolean)
  );
  const exposedHolders = validRugHolders(report).filter((holder) =>
    !marketOwners.has(holder?.address) && !marketOwners.has(holder?.owner) && toFiniteNumber(holder?.pct) != null
  ).sort((a, b) => Number(b.pct) - Number(a.pct));
  if (exposedHolders.length) {
    metrics.topHolderPct = toFiniteNumber(exposedHolders[0]?.pct);
    metrics.top10Pct = exposedHolders.slice(0, 10).reduce((sum, holder) => sum + Number(holder?.pct || 0), 0);
    metrics.topHolders = exposedHolders.slice(0, 10).map((holder) => ({
      address: holder.owner || holder.address,
      percentage: toFiniteNumber(holder.pct),
      insider: typeof holder.insider === "boolean" ? holder.insider : null,
      source: "RugCheck snapshot", kind: holder.owner ? "owner" : "token account",
      url: explorerLink("solana", holder.owner || holder.address)
    }));

    if (metrics.topHolderPct > 10) {
      findings.push(finding("danger", "SOL_TOP_HOLDER_CRITICAL", "Single exposed holder controls over 10%", `${formatPct(metrics.topHolderPct)} is held by ${shortAddress(exposedHolders[0].owner || exposedHolders[0].address)}.`, "Distribution", true));
    } else if (metrics.topHolderPct > 5) {
      findings.push(finding("warn", "SOL_TOP_HOLDER_HIGH", "Large exposed holder", `${formatPct(metrics.topHolderPct)} is held by ${shortAddress(exposedHolders[0].owner || exposedHolders[0].address)}.`, "Distribution"));
    } else {
      findings.push(finding("good", "SOL_TOP_HOLDER_MODERATE", "No exposed holder above 5%", `Largest non-market balance in the RugCheck snapshot: ${formatPct(metrics.topHolderPct)}.`, "Distribution"));
    }
  }

  const poolsWithValue = (Array.isArray(report.markets) ? report.markets : []).map((market) => ({
    market,
    value: Number(market?.lp?.baseUSD || 0) + Number(market?.lp?.quoteUSD || 0)
  }));
  const strongestPoolValue = Math.max(0, ...poolsWithValue.map((entry) => entry.value));
  const materialPoolFloor = Math.max(100, strongestPoolValue * 0.02);
  const lpSnapshots = poolsWithValue
    .filter((entry) => entry.value >= materialPoolFloor && Number(entry.market?.lp?.lpTotalSupply || 0) > 0)
    .map((entry) => toFiniteNumber(entry.market?.lp?.lpLockedPct))
    .filter((value) => value != null);
  if (lpSnapshots.length) {
    metrics.lpLockedPct = Math.min(...lpSnapshots);
    if (metrics.lpLockedPct < 80) {
      findings.push(finding("danger", "LP_UNLOCKED", "Material liquidity appears unlocked", `The lowest reported pool lock is ${formatPct(metrics.lpLockedPct)}.`, "Liquidity", true));
    } else {
      findings.push(finding("good", "LP_LOCKED", "Liquidity lock reported", `The lowest reported pool lock is ${formatPct(metrics.lpLockedPct)}.`, "Liquidity"));
    }
  }
}

function slug(value) {
  return String(value || "UNKNOWN").toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 60);
}

const TOKEN_PROGRAMS = new Set(["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"]);
const isMintInfo = (info) => info && /^\d+$/.test(String(info.supply ?? "")) && Number.isInteger(info.decimals) && info.decimals >= 0 && info.decimals <= 255;

function validMintResult(result) {
  const account = result?.value;
  return Boolean(account && TOKEN_PROGRAMS.has(account.owner) && account.data?.parsed?.type === "mint" && isMintInfo(account.data.parsed.info));
}

function validLargestResult(result) {
  return Array.isArray(result?.value) && result.value.length > 0 && result.value.every((entry) =>
    /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(entry?.address || "") && /^\d+$/.test(String(entry?.amount ?? "")));
}

function validRugReport(report, address) {
  return report?.mint === address && Array.isArray(report.risks) && isMintInfo(report.token);
}

function validRugHolders(report) {
  return (Array.isArray(report?.topHolders) ? report.topHolders : []).filter((holder) =>
    /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(holder?.owner || holder?.address || "") &&
    toFiniteNumber(holder?.pct) != null && Number(holder.pct) >= 0 && Number(holder.pct) <= 100);
}

async function scanSolana(target, options = {}) {
  const [mintResult, largestResult, rugResult, dexResult, geckoResult, metadataResult] = await Promise.all([
    attemptRpc("Solana mint", "getAccountInfo", [target.address, { encoding: "jsonParsed", commitment: "confirmed" }], options, validMintResult),
    attemptRpc("Solana holders", "getTokenLargestAccounts", [target.address, { commitment: "confirmed" }], options, validLargestResult),
    attempt("RugCheck", () => fetchJson(`${RUGCHECK_BASE}/${target.address}/report`, { signal: options.signal }, options.timeoutMs, options.fetchImpl), {
      provider: "api.rugcheck.xyz", validate: (report) => validRugReport(report, target.address), signal: options.signal, url: `https://rugcheck.xyz/tokens/${target.address}`
    }),
    attempt("DEX market", () => scanDex(target.address, "solana", options), { provider: "api.dexscreener.com", signal: options.signal, url: `https://dexscreener.com/solana/${target.address}` }),
    ...geckoChecks(target, options)
  ]);

  // A risk-provider snapshot can supply distribution evidence when public RPCs
  // restrict their expensive largest-account query. Do not call it a live RPC read.
  if (!largestResult.ok && rugResult.ok && validRugHolders(rugResult.data).length) {
    largestResult.ok = true;
    largestResult.snapshot = true;
    largestResult.provider = "api.rugcheck.xyz";
    largestResult.checkedAt = rugResult.checkedAt;
    largestResult.message = "Holder distribution is available from a RugCheck snapshot. Direct node checks did not complete; the snapshot's underlying age is not supplied.";
    largestResult.error = null;
  }

  const findings = [];
  const metrics = {};
  const identity = { address: target.address, chain: "Solana", platform: target.platform };
  const sources = [mintResult, largestResult, rugResult, dexResult, geckoResult, metadataResult].map(sourceSummary);

  const mintAccount = mintResult.ok ? mintResult.data?.value : null;
  const mintInfo = mintAccount?.data?.parsed?.info;
  identity.name = rugResult.ok ? rugResult.data?.tokenMeta?.name : null;
  identity.symbol = rugResult.ok ? rugResult.data?.tokenMeta?.symbol : null;
  if (!mintAccount || !mintInfo) {
    findings.push(finding("unknown", "MINT_UNREADABLE", "Mint account could not be verified", mintResult.error || "The checked Solana providers did not return a matching parsed mint account.", "Identity"));
  } else {
    identity.tokenProgram = mintAccount.owner;
    metrics.supply = mintInfo.supply;
    metrics.decimals = mintInfo.decimals;
    metrics.mintAuthority = mintInfo.mintAuthority ?? null;
    metrics.freezeAuthority = mintInfo.freezeAuthority ?? null;
    metrics.mintAuthorityStatus = mintInfo.mintAuthority ? "active" : mintInfo.mintAuthority === null ? "revoked" : "unknown";
    metrics.freezeAuthorityStatus = mintInfo.freezeAuthority ? "active" : mintInfo.freezeAuthority === null ? "revoked" : "unknown";

    if (mintInfo.mintAuthority) {
      findings.push(finding("danger", "MINT_AUTHORITY_ACTIVE", "Mint authority is active", `Authority ${mintInfo.mintAuthority} may be able to create more supply.`, "Authority", true));
    } else if (mintInfo.mintAuthority === null) {
      findings.push(finding("good", "MINT_AUTHORITY_REVOKED", "Mint authority revoked", "The parsed mint account reports no active mint authority.", "Authority"));
    } else {
      findings.push(finding("unknown", "MINT_AUTHORITY_UNKNOWN", "Mint authority not verified", "The parsed data omitted the mint-authority field.", "Authority"));
    }

    if (mintInfo.freezeAuthority) {
      findings.push(finding("danger", "FREEZE_AUTHORITY_ACTIVE", "Freeze authority is active", `Authority ${mintInfo.freezeAuthority} may be able to freeze token accounts.`, "Authority", true));
    } else if (mintInfo.freezeAuthority === null) {
      findings.push(finding("good", "FREEZE_AUTHORITY_REVOKED", "Freeze authority revoked", "The parsed mint account reports no active freeze authority.", "Authority"));
    } else {
      findings.push(finding("unknown", "FREEZE_AUTHORITY_UNKNOWN", "Freeze authority not verified", "The parsed data omitted the freeze-authority field.", "Authority"));
    }

    if (Array.isArray(mintInfo.extensions) && mintInfo.extensions.length) {
      const types = mintInfo.extensions.map((extension) => extension.extension || extension.type).filter(Boolean);
      findings.push(finding("warn", "TOKEN_EXTENSIONS", "Token extensions require review", `Detected: ${types.join(", ") || "one or more Token-2022 extensions"}.`, "Authority"));
    }
  }

  const largest = largestResult.ok ? largestResult.data?.value : null;
  if (Array.isArray(largest) && largest.length && mintInfo?.supply) {
    const percentages = largest.map((entry) => integerPercentage(entry.amount, mintInfo.supply)).filter((value) => value != null);
    metrics.rawLargestAccountPct = percentages[0] ?? null;
    metrics.rawTop10Pct = percentages.slice(0, 10).reduce((sum, value) => sum + value, 0);
    metrics.rawTopHolders = largest.slice(0, 10).map((entry) => ({ address: entry.address, percentage: integerPercentage(entry.amount, mintInfo.supply), kind: "token account (may be a pool or vault)", source: "Solana RPC", url: explorerLink("solana", entry.address) }));
    findings.push(finding("info", "RAW_HOLDER_CONCENTRATION", "Largest-account snapshot", `The largest raw token account holds ${formatPct(metrics.rawLargestAccountPct)} and the raw top 10 hold ${formatPct(metrics.rawTop10Pct)}. Pool and vault accounts may be included.`, "Distribution"));
  } else if (!(rugResult.ok && Array.isArray(rugResult.data?.topHolders) && rugResult.data.topHolders.length)) {
    findings.push(finding("unknown", "HOLDER_DISTRIBUTION_UNKNOWN", "Holder distribution unavailable", "The public endpoint did not return the largest token accounts.", "Distribution"));
  }

  if (rugResult.ok) {
    analyzeSolanaRugCheck(rugResult.data, findings, metrics, identity);
  } else {
    findings.push(finding("unknown", "RUGCHECK_UNAVAILABLE", "Independent Solana risk report unavailable", rugResult.error, "On-chain risk"));
  }

  const dex = selectMarket(dexResult, geckoResult, findings);
  analyzeDex(dex, findings, metrics);
  analyzeProjectLinks(dex, findings, identity, rugResult.ok ? rugResult.data : null, metadataResult.ok ? metadataResult.data : null);
  identity.name ||= dex?.baseToken?.name || null;
  identity.symbol ||= dex?.baseToken?.symbol || null;

  const creatorHistoryCovered = findings.some((item) => /CREATOR_HISTORY|SERIAL_CREATOR|RUGGED_TOKENS/.test(item.code));
  if (!creatorHistoryCovered) {
    findings.push(finding("unknown", "CREATOR_HISTORY_BASIC", "Creator history needs deeper indexing", "These checks consult known risk sources but does not yet prove the creator's complete previous-launch history.", "Creator"));
  }

  if (!metrics.topHolders?.length && metrics.rawTopHolders?.length) metrics.topHolders = metrics.rawTopHolders;
  supplementMetadata(metrics, metadataResult);
  reconcileHolderCounts(metrics, findings);
  return finalizeReport(target, identity, metrics, findings, sources, dex, geckoResult.ok ? geckoResult.data : null);
}

function sourceSummary(result) {
  return {
    name: result.name, ok: result.ok, provider: result.provider || null,
    url: safeProjectUrl(result.url), upstreamUpdatedAt: result.data?.updatedAt || null,
    freshness: "Fresh request; provider indexing/cache delay may apply",
    checkedAt: result.checkedAt || new Date().toISOString(),
    attempts: result.attempts || [], snapshot: result.snapshot === true,
    message: result.message || (result.ok ? `Usable data received${result.attempts?.length > 1 ? " from a fallback provider" : ""}.` : result.error),
    error: result.ok ? null : result.error
  };
}

function extractAbiFunctions(contract) {
  const abi = Array.isArray(contract?.abi) ? contract.abi : [];
  return abi.filter((item) => item?.type === "function" && item?.name).map((item) => item.name);
}

function analyzeGoPlus(data, address, findings, metrics) {
  const token = data?.result?.[address.toLowerCase()] || data?.result?.[address] || null;
  if (!token) return false;

  const hardFlags = [
    ["is_honeypot", "HONEYPOT", "Honeypot behavior reported"],
    ["cannot_sell_all", "CANNOT_SELL", "Selling restrictions reported"],
    ["owner_change_balance", "OWNER_BALANCE_CONTROL", "Owner may change holder balances"]
  ];
  for (const [field, code, title] of hardFlags) {
    if (String(token[field]) === "1") {
      findings.push(finding("danger", code, title, "The independent token-security response marked this condition as present.", "Sellability", true));
    }
  }

  const warningFlags = [
    ["is_mintable", "MINTABLE", "Additional supply may be mintable"],
    ["hidden_owner", "HIDDEN_OWNER", "Hidden owner behavior reported"],
    ["can_take_back_ownership", "OWNERSHIP_RECOVERABLE", "Ownership may be recoverable"],
    ["transfer_pausable", "TRANSFER_PAUSABLE", "Transfers may be pausable"],
    ["is_blacklisted", "BLACKLIST", "Blacklist behavior reported"],
    ["slippage_modifiable", "TAX_MODIFIABLE", "Trading tax or slippage may be modifiable"],
    ["personal_slippage_modifiable", "PERSONAL_TAX", "Per-address trading tax may be modifiable"],
    ["selfdestruct", "SELFDESTRUCT", "Self-destruct behavior reported"],
    ["is_proxy", "GOPLUS_PROXY", "Upgradeable proxy reported"]
  ];
  for (const [field, code, title] of warningFlags) {
    if (String(token[field]) === "1") {
      findings.push(finding("warn", code, title, "This privileged behavior requires manual ownership and timelock verification.", "Authority"));
    }
  }

  const buyTax = toFiniteNumber(token.buy_tax);
  const sellTax = toFiniteNumber(token.sell_tax);
  metrics.buyTax = buyTax;
  metrics.sellTax = sellTax;
  if ((sellTax != null && sellTax > 0.1) || (buyTax != null && buyTax > 0.1)) {
    findings.push(finding("danger", "HIGH_TAX", "High trading tax reported", `Buy tax: ${formatPct(buyTax == null ? null : buyTax * 100)}; sell tax: ${formatPct(sellTax == null ? null : sellTax * 100)}.`, "Sellability", true));
  } else if (buyTax != null || sellTax != null) {
    findings.push(finding("info", "TAX_CHECKED", "Trading-tax data returned", `Buy tax: ${formatPct(buyTax == null ? null : buyTax * 100)}; sell tax: ${formatPct(sellTax == null ? null : sellTax * 100)}. Provider estimates are not a guaranteed executable quote.`, "Sellability"));
  }
  if (!["0", "1"].includes(String(token.is_honeypot)) || !["0", "1"].includes(String(token.cannot_sell_all))) findings.push(finding("unknown", "SELLABILITY_PARTIAL", "Sellability checks are incomplete", "The security response omitted one or more selling-restriction results; a missing field is not a pass.", "Sellability"));
  return true;
}

async function scanEvmCreator(creatorAddress, options = {}) {
  if (!creatorAddress) return null;
  const data = await fetchJson(`${options.blockscoutBase}/addresses/${creatorAddress}/transactions?filter=from`, { signal: options.signal }, options.timeoutMs, options.fetchImpl);
  if (!Array.isArray(data?.items)) throw new Error("No usable creator-history data was returned for this check.");
  const items = data.items;
  const creations = items.filter((item) => EVM_ADDRESS.test(normalizeAddress(item?.created_contract)) && item?.status !== "error");
  return { recentTransactions: items.length, recentContractCreations: creations.length,
    coverage: "Only the returned recent outgoing-transaction page; contract creations are not necessarily token launches or rugs.",
    previousContracts: creations.slice(0, 20).map((item) => ({ address: normalizeAddress(item.created_contract), timestamp: item.timestamp || null, url: explorerLink(options.chain, normalizeAddress(item.created_contract)) })) };
}

async function scanEvm(target, options = {}) {
  const address = target.address;
  const config = RESEARCH_CHAINS[target.chain];
  const blockscoutBase = config.blockscout ? `${config.blockscout}/api/v2` : null;
  const unavailable = (name) => Promise.resolve({ name, ok: false, error: "This source is not configured for this chain. Explorer links are provided for manual review." });
  const json = (url, init = {}) => fetchJson(url, { ...init, signal: options.signal }, options.timeoutMs, options.fetchImpl);
  const [tokenResult, holdersResult, contractResult, goPlusResult, dexResult, geckoResult, metadataResult, addressResult] = await Promise.all([
    blockscoutBase ? attempt("Blockscout token", () => json(`${blockscoutBase}/tokens/${address}`), {
      signal: options.signal, provider: new URL(blockscoutBase).hostname, url: explorerLink(target.chain, address, "token"),
      validate: (data) => String(data?.address_hash || "").toLowerCase() === address.toLowerCase() && (data?.symbol != null || data?.total_supply != null)
    }) : unavailable("Blockscout token"),
    blockscoutBase ? attempt("Blockscout holders", () => json(`${blockscoutBase}/tokens/${address}/holders`), {
      signal: options.signal, provider: new URL(blockscoutBase).hostname, url: explorerLink(target.chain, address, "token"),
      validate: (data) => Array.isArray(data?.items) && data.items.length > 0 && data.items.every((item) => EVM_ADDRESS.test(normalizeAddress(item)) && /^\d+$/.test(String(item.value ?? "")))
    }) : unavailable("Blockscout holders"),
    blockscoutBase ? attempt("Verified contract", () => json(`${blockscoutBase}/smart-contracts/${address}`), {
      signal: options.signal, provider: new URL(blockscoutBase).hostname, url: explorerLink(target.chain, address),
      validate: (data) => typeof data?.is_verified === "boolean" || ["true", "false"].includes(data?.is_verified) || Array.isArray(data?.abi)
    }) : unavailable("Verified contract"),
    attempt("GoPlus security", () => json(`${GOPLUS_BASE}/${config.id}?contract_addresses=${address.toLowerCase()}`), {
      signal: options.signal, provider: "api.gopluslabs.io", url: `https://gopluslabs.io/token-security/${config.id}/${address}`,
      validate: (data) => Number(data?.code) === 1 && hasData(data?.result?.[address.toLowerCase()] || data?.result?.[address]) && ["is_honeypot", "is_open_source", "is_mintable", "buy_tax", "sell_tax", "holder_count"].some((key) => Object.hasOwn(data.result[address.toLowerCase()] || data.result[address], key))
    }),
    attempt("DEX market", () => scanDex(address, target.chain, options), { provider: "api.dexscreener.com", signal: options.signal, url: `https://dexscreener.com/${target.chain}/${address}` }),
    ...geckoChecks(target, options),
    blockscoutBase ? attempt("Contract address", () => json(`${blockscoutBase}/addresses/${address}`), {
      signal: options.signal, provider: new URL(blockscoutBase).hostname, url: explorerLink(target.chain, address),
      validate: (data) => String(data?.hash || "").toLowerCase() === address.toLowerCase()
    }) : unavailable("Contract address")
  ]);

  const findings = [];
  const metrics = {};
  const token = tokenResult.ok ? tokenResult.data : null;
  const contract = contractResult.ok ? contractResult.data : null;
  const goPlusToken = goPlusResult.ok ? goPlusResult.data.result[address.toLowerCase()] || goPlusResult.data.result[address] : null;
  const creatorEntry = [
    { address: normalizeAddress(addressResult.ok ? addressResult.data.creator_address_hash : null), source: "Blockscout creator field" },
    { address: normalizeAddress(contract?.creator_address_hash || contract?.creator_address || token?.creator_address_hash), source: "Blockscout creator field" },
    { address: goPlusToken?.creator_address, source: "GoPlus creator field" }
  ].find((entry) => EVM_ADDRESS.test(entry.address || ""));
  const creatorAddress = creatorEntry?.address || null;
  const creatorResult = creatorAddress && blockscoutBase
    ? await attempt("Creator history", () => scanEvmCreator(creatorAddress, { ...options, blockscoutBase, chain: target.chain }), { signal: options.signal, provider: new URL(blockscoutBase).hostname, url: explorerLink(target.chain, creatorAddress) })
    : { name: "Creator history", ok: false, error: creatorAddress ? "No public creator-history provider is configured for this chain." : "Creator address unavailable" };
  const sources = [tokenResult, holdersResult, contractResult, goPlusResult, dexResult, geckoResult, metadataResult, addressResult, creatorResult].map(sourceSummary);
  const identity = {
    address,
    chain: config.name,
    platform: target.platform,
    name: token?.name || null,
    contractName: contract?.name || null,
    symbol: token?.symbol || null,
    creator: creatorAddress || null,
    creatorSource: creatorEntry?.source || null
  };

  if (token) {
    metrics.holders = null;
    recordHolderCount(metrics, token.holders_count, "Blockscout token");
    metrics.totalSupply = token.total_supply || null;
    metrics.decimals = toFiniteNumber(token.decimals);
    metrics.transfers = toFiniteNumber(token.transfers_count || token.transfer_count);
    findings.push(finding("good", "TOKEN_FOUND", "Exact token found on Blockscout", `${identity.name || "Token"}${identity.symbol ? ` (${identity.symbol})` : ""} resolves to the supplied contract.`, "Identity"));
  } else if (tokenResult.ok) {
    findings.push(finding("unknown", "TOKEN_NOT_FOUND", "Token contract not found", `The exact address did not resolve as a token through the configured ${config.name} explorer.`, "Identity"));
  } else {
    findings.push(finding("unknown", "TOKEN_LOOKUP_UNAVAILABLE", "Token identity lookup unavailable", tokenResult.error || "The explorer could not be reached.", "Identity"));
  }

  if (contract) {
    if (contract.is_verified === true || contract.is_verified === "true") {
      findings.push(finding("good", "SOURCE_VERIFIED", "Contract source is verified", "The explorer returned verified contract information.", "Contract"));
    } else if (contract.is_verified === false || contract.is_verified === "false") {
      findings.push(finding("danger", "SOURCE_UNVERIFIED", "Contract source is unverified", "Privileged or restrictive logic cannot be reliably reviewed from source.", "Contract"));
    } else {
      findings.push(finding("unknown", "SOURCE_VERIFICATION_UNKNOWN", "Source verification is unknown", "An ABI was returned but the source-verification flag was missing.", "Contract"));
    }

    const isProxy = contract.is_proxy === true || contract.is_proxy === "true" || (contract.implementations || []).length > 0;
    if (isProxy) {
      findings.push(finding("warn", "PROXY_CONTRACT", "Upgradeable/proxy structure detected", "Confirm the implementation, administrator and upgrade timelock during independent review.", "Authority"));
    }

    const functions = extractAbiFunctions(contract);
    const privileged = functions.filter((name) => /(mint|blacklist|blocklist|pause|freeze|tax|fee|maxTx|trading|upgradeTo|setLimit)/i.test(name));
    if (privileged.length) {
      findings.push(finding("warn", "PRIVILEGED_FUNCTIONS", "Privileged-looking functions exposed", `Review access controls for: ${[...new Set(privileged)].slice(0, 12).join(", ")}.`, "Authority"));
    }
  } else {
    findings.push(finding("unknown", "CONTRACT_DETAILS_UNAVAILABLE", "Verified contract details unavailable", contractResult.error, "Contract"));
  }

  const goPlusAvailable = goPlusResult.ok && analyzeGoPlus(goPlusResult.data, address, findings, metrics);
  if (!contract && goPlusToken?.is_open_source === "0") findings.push(finding("warn", "GOPLUS_SOURCE_UNVERIFIED", "Security provider reports unverified source", "GoPlus marks the source as not open/verified. This app has not independently reviewed the bytecode or source.", "Contract"));
  else if (!contract && goPlusToken?.is_open_source === "1") findings.push(finding("info", "GOPLUS_SOURCE_REPORTED", "Security provider reports open source", "GoPlus reports source availability. Review the explorer source and administration; this is not an audit.", "Contract"));
  if (!goPlusAvailable) {
    findings.push(finding("unknown", "SELL_SIMULATION_UNAVAILABLE", "Independent sellability result unavailable", "GoPlus did not return coverage for this chain/address. A yellow result must not be treated as confirmed sellability.", "Sellability"));
  }

  const holders = holdersResult.ok && Array.isArray(holdersResult.data?.items) ? holdersResult.data.items : [];
  if (holders.length && token?.total_supply) {
    const rows = holders.map((entry) => ({
      address: normalizeAddress(entry),
      label: holderLabel(entry),
      isContract: typeof (entry.address_hash || entry.address)?.is_contract === "boolean" ? (entry.address_hash || entry.address).is_contract : null,
      protocol: BURN_ADDRESSES.has(normalizeAddress(entry).toLowerCase()),
      percentage: integerPercentage(entry.value, token.total_supply),
      source: "Blockscout holder page", kind: "address (labels are not proof of ownership)",
      url: explorerLink(target.chain, normalizeAddress(entry))
    })).filter((row) => row.percentage != null && row.percentage >= 0 && row.percentage <= 100).sort((a, b) => b.percentage - a.percentage);
    const exposed = rows.filter((row) => !row.protocol);
    metrics.topHolderPct = exposed[0]?.percentage ?? null;
    metrics.top10Pct = exposed.slice(0, 10).reduce((sum, row) => sum + row.percentage, 0);
    metrics.topHolders = rows.slice(0, 10);

    if (metrics.topHolderPct > 10 && exposed[0].isContract === false) {
      findings.push(finding("danger", "TOP_HOLDER_CRITICAL", "Single non-contract holder controls over 10%", `${formatPct(metrics.topHolderPct)} is held by ${shortAddress(exposed[0].address)}. Beneficial ownership and related wallets remain unverified.`, "Distribution", true));
    } else if (metrics.topHolderPct > 10) {
      findings.push(finding("warn", "TOP_BALANCE_REVIEW", "Large balance requires ownership review", `${formatPct(metrics.topHolderPct)} is held by ${shortAddress(exposed[0].address)}. This may be a pool or contract; a display label alone does not establish its role.`, "Distribution"));
    } else if (metrics.topHolderPct > 5) {
      findings.push(finding("warn", "TOP_HOLDER_HIGH", "Large exposed holder", `${formatPct(metrics.topHolderPct)} is held by ${shortAddress(exposed[0].address)}.`, "Distribution"));
    } else if (metrics.topHolderPct != null) {
      findings.push(finding("good", "TOP_HOLDER_MODERATE", "No exposed holder above 5% in this page", `Largest non-protocol balance: ${formatPct(metrics.topHolderPct)}. Labels can be incomplete.`, "Distribution"));
    }

    if (metrics.top10Pct > 30) {
      findings.push(finding("danger", "TOP10_CONCENTRATION", "High exposed top-10 concentration", `Non-protocol balances in the returned top 10 total approximately ${formatPct(metrics.top10Pct)}.`, "Distribution"));
    } else if (metrics.top10Pct > 20) {
      findings.push(finding("warn", "TOP10_CONCENTRATION", "Elevated exposed top-10 concentration", `Non-protocol balances in the returned top 10 total approximately ${formatPct(metrics.top10Pct)}.`, "Distribution"));
    }
  } else if (goPlusToken && Array.isArray(goPlusToken.holders) && goPlusToken.holders.length) {
    metrics.topHolders = goPlusToken.holders.filter((holder) => EVM_ADDRESS.test(holder.address || "") && toFiniteNumber(holder.percent) != null && Number(holder.percent) >= 0 && Number(holder.percent) <= 1).map((holder) => ({ address: holder.address, percentage: Number(holder.percent) * 100, label: String(holder.tag || ""), source: "GoPlus snapshot", kind: "address (pool and contract accounts may be included)", url: explorerLink(target.chain, holder.address) })).sort((a, b) => b.percentage - a.percentage).slice(0, 10);
    const exposed = metrics.topHolders.filter((holder) => !BURN_ADDRESSES.has(holder.address.toLowerCase()));
    metrics.topHolderPct = exposed[0]?.percentage ?? null;
    metrics.top10Pct = exposed.length ? exposed.reduce((sum, holder) => sum + holder.percentage, 0) : null;
    findings.push(finding("info", "HOLDERS_SECURITY_SNAPSHOT", "Holder snapshot from GoPlus", "These are the returned top balances, not a complete ownership or linked-wallet map. Pool and contract balances may be included.", "Distribution"));
    if (metrics.topHolderPct > 10) findings.push(finding("warn", "GOPLUS_TOP_HOLDER_HIGH", "Large balance requires ownership review", `The largest returned non-burn balance is ${formatPct(metrics.topHolderPct)}. It may be a pool or contract; verify the address.`, "Distribution"));
  } else {
    findings.push(finding("unknown", "HOLDER_DISTRIBUTION_UNKNOWN", "Holder distribution unavailable", holdersResult.error || "No holder page was returned.", "Distribution"));
  }

  if (creatorAddress && creatorResult.ok && creatorResult.data) {
    metrics.creatorRecentContractCreations = creatorResult.data.recentContractCreations;
    metrics.creatorRecentTransactions = creatorResult.data.recentTransactions;
    metrics.creatorPreviousContracts = creatorResult.data.previousContracts;
    metrics.creatorHistoryCoverage = creatorResult.data.coverage;
    if (creatorResult.data.recentContractCreations >= 3) {
      findings.push(finding("warn", "SERIAL_DEPLOYER", "Creator has several recent contract creations", `${creatorResult.data.recentContractCreations} contract creations appear in the returned recent transaction page. Inspect them during independent review.`, "Creator"));
    } else {
      findings.push(finding("info", "CREATOR_IDENTIFIED", "Creator address identified", `${shortAddress(creatorAddress)}; ${creatorResult.data.recentContractCreations} recent contract creation(s) were visible.`, "Creator"));
    }
  } else {
    findings.push(finding("unknown", "CREATOR_UNKNOWN", "Creator history incomplete", "The basic explorer response did not expose enough creator history for a reliable prior-launch verdict.", "Creator"));
  }

  recordHolderCount(metrics, goPlusToken?.holder_count, "GoPlus security");
  const creatorShare = toFiniteNumber(goPlusToken?.creator_percent);
  metrics.developerHoldingsPct = creatorShare != null && creatorShare >= 0 && creatorShare <= 1 ? creatorShare * 100 : null;
  metrics.ownerAddress = EVM_ADDRESS.test(goPlusToken?.owner_address || "") ? goPlusToken.owner_address : null;
  const dex = selectMarket(dexResult, geckoResult, findings);
  analyzeDex(dex, findings, metrics);
  analyzeProjectLinks(dex, findings, identity, null, metadataResult.ok ? metadataResult.data : null);
  identity.name ||= dex?.baseToken?.name || goPlusToken?.token_name || null;
  identity.symbol ||= dex?.baseToken?.symbol || goPlusToken?.token_symbol || null;
  supplementMetadata(metrics, metadataResult);
  reconcileHolderCounts(metrics, findings);
  if (metrics.developerHoldingsPct > 10) findings.push(finding("warn", "DEVELOPER_BALANCE_HIGH", "Developer balance needs review", `A source reports ${formatPct(metrics.developerHoldingsPct)} held by the creator/developer address. This does not include undiscovered linked wallets.`, "Distribution"));

  return finalizeReport(target, identity, metrics, findings, sources, dex, geckoResult.ok ? geckoResult.data : null);
}

function severityPenalty(item) {
  if (item.hardFail) return 45;
  return { danger: 22, warn: 9, unknown: 3, info: 0, good: -2 }[item.severity] ?? 0;
}

export function classifyFindings(findings, confidence) {
  const hardFails = findings.filter((item) => item.hardFail);
  const riskScore = Math.max(0, Math.min(100, findings.reduce((sum, item) => sum + severityPenalty(item), 0)));
  let tier;
  if (hardFails.length) tier = "REJECT";
  else if (riskScore >= 60) tier = "RED";
  else if (confidence < 35) tier = "UNKNOWN";
  else if (riskScore >= 30) tier = "AMBER";
  else tier = "YELLOW";
  return { tier, riskScore, hardFailCount: hardFails.length };
}

function calculateConfidence(sources, findings) {
  const successful = sources.reduce((sum, source) => sum + (source.ok ? source.snapshot ? 0.5 : 1 : 0), 0);
  const sourceCoverage = sources.length ? successful / sources.length : 0;
  const unknownCount = findings.filter((item) => item.severity === "unknown").length;
  return Math.max(5, Math.min(100, Math.round(sourceCoverage * 90 + 10 - unknownCount * 5)));
}

function momentumFrom(dex) {
  if (!dex) return { label: "Unknown", score: null };
  const change = toFiniteNumber(dex?.priceChange?.h1);
  const buys = toFiniteNumber(dex?.txns?.h1?.buys);
  const sells = toFiniteNumber(dex?.txns?.h1?.sells);
  const volume = toFiniteNumber(dex?.volume?.h1);
  if ([change, buys, sells, volume].some((value) => value == null)) return { label: "Unknown", score: null };
  const flow = buys + sells ? (buys - sells) / (buys + sells) : 0;
  const score = Math.max(0, Math.min(100, Math.round(50 + change * 0.6 + flow * 25 + Math.min(15, Math.log10(volume + 1) * 3))));
  const label = score >= 70 ? "Strong" : score >= 55 ? "Positive" : score >= 40 ? "Mixed" : "Weak";
  return { label, score };
}

function finalizeReport(target, identity, metrics, findings, sources, dex, corroboration = null) {
  const confidence = calculateConfidence(sources, findings);
  const classification = classifyFindings(findings, confidence);
  const report = {
    version: 2,
    generatedAt: new Date().toISOString(),
    target,
    identity,
    metrics,
    findings: findings.sort((a, b) => severityOrder(a.severity) - severityOrder(b.severity)),
    sources,
    confidence,
    ...classification,
    momentum: momentumFrom(dex)
  };
  report.research = buildResearchReport(report, dex, corroboration);
  return report;
}

function severityOrder(value) {
  return { danger: 0, warn: 1, unknown: 2, info: 3, good: 4 }[value] ?? 5;
}

function formatPct(value) {
  return value == null ? "unknown" : `${Number(value).toFixed(2)}%`;
}

function shortAddress(value) {
  const text = String(value || "");
  return text.length > 14 ? `${text.slice(0, 7)}…${text.slice(-5)}` : text;
}

export async function scanTarget(input, options = {}) {
  throwIfAborted(options.signal);
  const parsed = typeof input === "string" ? parseTarget(input) : parseTarget(input?.input || input?.address);
  if (!parsed || (typeof input === "object" && input.address !== parsed.address)) throw new Error("Paste an exact token address or a token/explorer URL, not a coin name or liquidity-pool chart URL.");
  const selectedChain = options.chain || (typeof input === "object" ? input.chain : null) || "auto";
  if (selectedChain !== "auto" && !Object.hasOwn(RESEARCH_CHAINS, selectedChain)) throw new Error("Please select a supported network.");
  if (selectedChain !== "auto" && parsed.chain !== "auto" && selectedChain !== parsed.chain) throw new Error("The selected network conflicts with this address or explorer URL. Choose the matching network.");
  if (selectedChain === "solana" && !SOLANA_ADDRESS.test(parsed.address)) throw new Error("A 0x contract is not a Solana mint. Choose its correct network.");
  const target = { ...parsed, chain: selectedChain !== "auto" ? selectedChain : parsed.chain };
  if (target.chain === "auto") {
    let data;
    try { data = await fetchJson(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(target.address)}`, { signal: options.signal }, options.timeoutMs, options.fetchImpl); }
    catch { throwIfAborted(options.signal); throw new Error("The network could not be confirmed. Select the project's network and check again."); }
    const chains = [...new Set((Array.isArray(data?.pairs) ? data.pairs : []).filter((pair) => String(pair?.baseToken?.address || "").toLowerCase() === target.address.toLowerCase()).map((pair) => pair.chainId))];
    if (chains.length !== 1 || !Object.hasOwn(RESEARCH_CHAINS, chains[0]) || chains[0] === "solana") throw new Error("This 0x address does not identify one unambiguous supported network. Select the project's network and check again.");
    target.chain = chains[0];
    target.chainResolution = "Unique exact-base-token match in DEX Screener; verify the selected network independently.";
  } else target.chainResolution = selectedChain !== "auto" ? "Network selected by you" : parsed.chain === "solana" ? "Solana address format" : "Network identified from explorer hostname";
  const report = await (target.chain === "solana" ? scanSolana(target, options) : scanEvm(target, options));
  await Promise.all([
    addRepositoryChecks(report, options),
    collectBuyerActivity(report, options).then((activity) => { report.research.buyerActivity = activity; })
  ]);
  throwIfAborted(options.signal);
  return report;
}

async function addRepositoryChecks(report, options) {
  const repos = [];
  for (const link of report.research.links) {
    if (link.kind !== "github") continue;
    const parsed = new URL(link.url), parts = parsed.pathname.split("/").filter(Boolean);
    if (parsed.hostname !== "github.com" || parts.length !== 2 || !parts.every((part) => /^[A-Za-z0-9_.-]+$/.test(part))) continue;
    const fullName = `${parts[0]}/${parts[1].replace(/\.git$/, "")}`;
    if (!repos.some((repo) => repo.fullName.toLowerCase() === fullName.toLowerCase())) repos.push({ fullName, url: `https://github.com/${fullName}` });
  }
  const results = await Promise.all(repos.slice(0, 2).map((repo) => attempt("GitHub repository", async () => {
    const data = await fetchJson(`https://api.github.com/repos/${repo.fullName}`, { signal: options.signal, headers: { Accept: "application/vnd.github+json" } }, options.timeoutMs, options.fetchImpl);
    if (data?.private !== false || String(data?.full_name || "").toLowerCase() !== repo.fullName.toLowerCase() || typeof data?.archived !== "boolean") return null;
    const date = (value) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
    return { name: data.full_name, url: repo.url, archived: data.archived, fork: typeof data.fork === "boolean" ? data.fork : null, createdAt: date(data.created_at), pushedAt: date(data.pushed_at), description: typeof data.description === "string" ? data.description.slice(0, 1000) : null, license: typeof data.license?.spdx_id === "string" ? data.license.spdx_id : null, source: "GitHub public API", attributionVerified: false };
  }, { provider: "api.github.com", signal: options.signal, url: repo.url })));
  report.research.repositories = results.filter((result) => result.ok).map((result) => result.data);
  report.sources.push(...results.map(sourceSummary));
  report.research.repositoryCoverage = repos.length ? "At most two directly reported repositories checked. Repository activity is not a code audit or proof this project owns the code." : "No direct repository URL was reported by the sources; repository history and code quality remain unknown.";
  for (const result of results) {
    if (result.ok && result.data.archived) report.research.concerns.push(`Reported repository ${result.data.name} is archived. Verify whether development moved elsewhere.`);
  }
  report.generatedAt = new Date().toISOString();
  report.research.freshness.fetchedAt = report.generatedAt;
}

export function compareReports(previous, current) {
  if (!previous || !current) return [];
  const alerts = [];
  if ((TIER_RANK[current.tier] || 0) > (TIER_RANK[previous.tier] || 0)) {
    alerts.push(`Risk tier worsened from ${previous.tier} to ${current.tier}.`);
  }
  if (current.riskScore - previous.riskScore >= 10) {
    alerts.push(`Risk score increased by ${current.riskScore - previous.riskScore} points.`);
  }
  const oldLiquidity = previous.metrics?.liquidityUsd;
  const newLiquidity = current.metrics?.liquidityUsd;
  if (oldLiquidity > 0 && newLiquidity != null && newLiquidity < oldLiquidity * 0.7) {
    alerts.push(`Visible liquidity fell ${Math.round((1 - newLiquidity / oldLiquidity) * 100)}%.`);
  }
  const oldTop = previous.metrics?.topHolderPct;
  const newTop = current.metrics?.topHolderPct;
  if (oldTop != null && newTop != null && newTop - oldTop >= 2) {
    alerts.push(`Largest exposed holder increased by ${(newTop - oldTop).toFixed(2)} percentage points.`);
  }
  const oldCodes = new Set((previous.findings || []).map((item) => item.code));
  for (const item of current.findings || []) {
    if (item.hardFail && !oldCodes.has(item.code)) alerts.push(`New hard failure: ${item.title}.`);
  }
  return alerts;
}
