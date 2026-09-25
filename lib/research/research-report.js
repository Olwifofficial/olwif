// Read-only report presentation and chain identity. No wallet or transaction code.
export const RESEARCH_CHAINS = Object.freeze({
  solana: { name: "Solana", gecko: "solana", explorer: "https://solscan.io" },
  ethereum: { name: "Ethereum", id: "1", gecko: "eth", explorer: "https://etherscan.io", blockscout: "https://eth.blockscout.com" },
  base: { name: "Base", id: "8453", gecko: "base", explorer: "https://basescan.org", blockscout: "https://base.blockscout.com" },
  bsc: { name: "BNB Smart Chain", id: "56", gecko: "bsc", explorer: "https://bscscan.com" },
  arbitrum: { name: "Arbitrum One", id: "42161", gecko: "arbitrum", explorer: "https://arbiscan.io", blockscout: "https://arbitrum.blockscout.com" },
  polygon: { name: "Polygon", id: "137", gecko: "polygon_pos", explorer: "https://polygonscan.com" },
  optimism: { name: "Optimism", id: "10", gecko: "optimism", explorer: "https://optimistic.etherscan.io", blockscout: "https://optimism.blockscout.com" },
  avalanche: { name: "Avalanche C-Chain", id: "43114", gecko: "avax", explorer: "https://snowtrace.io" },
  blast: { name: "Blast", id: "81457", gecko: "blast", explorer: "https://blastscan.io" },
  robinhood: { name: "Robinhood Chain", id: "4663", gecko: "robinhood", explorer: "https://robinhoodchain.blockscout.com", blockscout: "https://robinhoodchain.blockscout.com" }
});

export function chainFromUrl(raw) {
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    for (const [chain, config] of Object.entries(RESEARCH_CHAINS)) {
      if ([config.explorer, config.blockscout].filter(Boolean).some((base) => new URL(base).hostname === url.hostname)) return chain;
    }
  } catch { /* A raw address has no chain-bearing host. */ }
  return null;
}

export function safeResearchUrl(raw) {
  if (typeof raw !== "string" || raw.length > 2048 || /[\u0000-\u001f\u007f]/.test(raw)) return null;
  try {
    const url = new URL(raw);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function explorerLink(chain, address, type = "address") {
  const valid = chain === "solana" ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address || "") : /^0x[a-fA-F0-9]{40}$/.test(address || "");
  const config = RESEARCH_CHAINS[chain];
  if (!valid || !config) return null;
  const path = chain === "solana" && type === "token" ? "token" : type === "token" ? "token" : "address";
  return `${config.explorer}/${path}/${address}`;
}

const num = (value) => value != null && value !== "" && typeof value !== "boolean" && Number.isFinite(Number(value)) ? Number(value) : null;

export function buildResearchReport(report, market, corroboration = null) {
  const { target, identity, metrics, findings, sources, momentum } = report;
  const negative = findings.filter((item) => ["danger", "warn"].includes(item.severity));
  const integrity = findings.filter((item) => ["Authority", "On-chain risk", "Sellability", "Contract", "Liquidity", "Distribution"].includes(item.category));
  const identityVerified = sources.some((source) => source.ok && ["Solana mint", "Blockscout token"].includes(source.name));
  const exactIndexed = sources.some((source) => source.ok && ["DEX market", "GeckoTerminal market", "GoPlus security", "RugCheck"].includes(source.name));
  const integrityFlags = integrity.filter((item) => ["danger", "warn"].includes(item.severity));
  const links = [];
  const addLink = (label, url, kind, source, verified = false) => {
    const safe = safeResearchUrl(url);
    if (safe && !links.some((link) => link.url === safe)) links.push({ label, url: safe, kind, source, verified });
  };
  addLink("Exact token on explorer", explorerLink(target.chain, target.address, "token"), "explorer", "Chain explorer");
  addLink("Creator / deployer", explorerLink(target.chain, identity.creator), "creator", identity.creatorSource || "Indexed report");
  addLink("Market chart", market?.url, "market", market?.provider || "DEX Screener");
  addLink("GeckoTerminal market", corroboration?.url, "market", "GeckoTerminal");
  if (target.chain === "solana") addLink("RugCheck report", `https://rugcheck.xyz/tokens/${target.address}`, "risk", "RugCheck");
  for (const link of [...(identity.websites || []), ...(identity.socials || [])]) {
    const url = safeResearchUrl(link.url);
    if (!url) continue;
    const host = new URL(url).hostname;
    const kind = host === "github.com" ? "github" : /docs|whitepaper/i.test(`${link.label} ${url}`) ? "docs" : (identity.socials || []).includes(link) ? "social" : "website";
    addLink(link.label || kind, url, kind, link.source);
  }
  const unknowns = [...new Set([
    ...findings.filter((item) => item.severity === "unknown").map((item) => `${item.title}: ${item.detail || "Not verified."}`),
    "A complete audit of the contract and all upgrade/admin paths has not been performed.",
    "Team identity, product functionality, document claims and GitHub code quality have not been independently verified.",
    "Social authenticity, purchased followers, coordinated promotion and private groups are not determined by these APIs.",
    "Linked wallets, bundles, snipers and wash trading are not fully mapped; visible buy/sell counts do not prove organic demand.",
    "Holder growth and early-wallet realised performance require historical coverage not provided by this single check.",
    "Creator prior launches and developer holdings may be incomplete; a metadata update authority is not automatically the creator."
  ])];
  const windows = [["m5", "5m"], ["h1", "1h"], ["h6", "6h"], ["h24", "24h"]].map(([key, window]) => {
    const buys = num(market?.txns?.[key]?.buys), sells = num(market?.txns?.[key]?.sells);
    return { window, volumeUsd: num(market?.volume?.[key]), buys, sells, transactions: buys != null && sells != null ? buys + sells : null, priceChangePct: num(market?.priceChange?.[key]) };
  });
  const classification = report.hardFailCount ? "Critical warning found" : report.tier === "UNKNOWN" ? "Not enough evidence" : negative.length ? "Caution — review the warnings" : "No critical warning found — not a safety guarantee";
  return {
    assessments: [
      { name: "Identity", status: identityVerified ? "Verified on-chain" : exactIndexed ? "Exact address indexed" : "Not verified", summary: `${identity.chain}: ${identityVerified ? "An exact-address on-chain/explorer response was received." : exactIndexed ? "An indexer matched the selected chain and exact token; direct on-chain identity is incomplete." : "The selected chain/address has not been independently confirmed."} Names and logos are not identity proof. Launchpad provenance is ${identity.launchpadVerified ? "reported" : "not verified"}.` },
      { name: "Integrity", status: integrityFlags.length ? "Warnings found" : integrity.some((item) => item.severity === "good") ? "Partial checks passed" : "Not verified", summary: integrityFlags.length ? `${integrityFlags.length} authority, contract, liquidity or concentration warning(s). Read the evidence below; this is not a full audit.` : "Only the listed checks were performed. Missing evidence is not a pass and exit execution is not guaranteed." },
      { name: "Substance", status: "Needs independent review", summary: links.some((link) => ["website", "social", "docs", "github"].includes(link.kind)) ? "Source-reported project links are available. Their content, team, product and claims have not been authenticated." : "No usable project links were returned by the checked sources. Team, product and claims remain unknown." },
      { name: "Momentum", status: momentum.label, summary: market ? "Indexed market snapshot for the strongest returned pool, not a live streaming quote. Momentum can reverse immediately." : "No matching indexed market with usable values was returned." },
      { name: "Flow quality", status: findings.some((item) => /INSIDER/.test(item.code)) ? "Insider warning reported" : "Not established", summary: "Transaction counts are visible where supplied. Wallet independence, organic demand, bundles and wash trading are not proven." }
    ],
    strengths: findings.filter((item) => item.severity === "good").map((item) => `${item.title}: ${item.detail}`),
    concerns: negative.map((item) => `${item.title}: ${item.detail}`),
    unknowns, links,
    market: { provider: market?.provider || (market ? "DEX Screener" : null), pairAddress: market?.pairAddress || null, poolUrl: market?.url || null, windows, corroboration },
    creator: { address: identity.creator || null, url: explorerLink(target.chain, identity.creator), source: identity.creatorSource || null, historyCoverage: metrics.creatorHistoryCoverage || "Unknown — full prior-launch history was not verified", recentTransactions: metrics.creatorRecentTransactions ?? null, recentContractCreations: metrics.creatorRecentContractCreations ?? null, previousContracts: metrics.creatorPreviousContracts || [] },
    freshness: { fetchedAt: report.generatedAt, upstreamUpdatedAt: null, description: "Fresh requests were made for this check. Provider indexing/caching delay is unknown unless stated. This is a timestamped snapshot, not continuous real-time monitoring." },
    classification,
    mainConcern: negative[0]?.detail || "Important due-diligence gaps remain. A lack of detected warnings does not establish safety.",
    whyItMightRun: momentum.score != null && momentum.score >= 55 ? "Recent indexed price/flow is positive; speculative attention can sustain momentum. This does not validate the project or predict returns." : "Speculation or new demand can move any thin market, but this snapshot does not establish a positive momentum case."
  };
}
