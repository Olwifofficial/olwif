import { NETWORKS } from "@/lib/security";

type SupportedNetwork = Exclude<(typeof NETWORKS)[number], "auto">;

const NETWORK_NAMES: Record<SupportedNetwork, string> = {
  solana: "Solana",
  ethereum: "Ethereum",
  base: "Base",
  bsc: "BNB Smart Chain",
  arbitrum: "Arbitrum One",
  polygon: "Polygon",
  optimism: "Optimism",
  avalanche: "Avalanche C-Chain",
  blast: "Blast",
  robinhood: "Robinhood Chain",
};

// Official destinations verified 2026-09-24. No affiliate or tracking parameters.
const NETWORK_HOMEPAGES: Record<SupportedNetwork, string> = {
  solana: "https://solana.com/",
  ethereum: "https://ethereum.org/",
  base: "https://www.base.org/",
  bsc: "https://www.bnbchain.org/en/bnb-smart-chain",
  arbitrum: "https://arbitrum.io/",
  polygon: "https://polygon.technology/",
  optimism: "https://optimism.io/",
  avalanche: "https://www.avalanche.com/",
  blast: "https://blast.io/",
  robinhood: "https://docs.robinhood.com/chain/",
};

export default function SupportedNetworks() {
  return (
    <div className="supported-networks">
      <p>Supported networks</p>
      <ul className="network-logo-row" aria-label="Supported blockchain networks">
        {NETWORKS.filter((network) => network !== "auto" && network !== "robinhood").map((network) => (
          <li key={network} title={NETWORK_NAMES[network]}>
            <a href={NETWORK_HOMEPAGES[network]} target="_blank" rel="noopener noreferrer" aria-label={`${NETWORK_NAMES[network]} official website (opens in a new tab)`}>
              <img src={`/networks/${network}.svg`} alt={NETWORK_NAMES[network]} width={30} height={30}/>
            </a>
          </li>
        ))}
      </ul>
      <div className="network-text-row">
        <a href={NETWORK_HOMEPAGES.robinhood} target="_blank" rel="noopener noreferrer" aria-label="Robinhood Chain official website (opens in a new tab)">Robinhood Chain</a>
      </div>
      <a className="network-affiliation-note" href="/terms#third-party-marks">Independent service · No affiliation</a>
    </div>
  );
}
