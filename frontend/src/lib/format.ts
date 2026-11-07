import { formatEther } from "ethers";
import { expectedChainId, ipfsGateway } from "../contracts";
import type { Campaign, CampaignMetadata } from "../types";

export const compactNumber = new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 1 });

export function formatEth(amount: bigint, digits = 3) {
  return Number(formatEther(amount)).toLocaleString("fr-FR", { maximumFractionDigits: digits });
}

export function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function sameAddress(a: string | undefined, b: string | undefined) {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

/** « 1 bloc », « 3 blocs » : accord du pluriel français. */
export function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count.toLocaleString("fr-FR")} ${Math.abs(count) > 1 ? pluralForm : singular}`;
}

// Forme d'un CID v0 (base58, préfixe Qm) ou v1 (base32, préfixe b). Contrôle de
// forme seulement : il écarte les chaînes de test qui produiraient un lien mort,
// sans prétendre vérifier que le contenu est réellement publié.
export const CID_PATTERN = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58,})$/;

export function toCid(hash: string) {
  return hash.replace(/^ipfs:\/\//, "").trim();
}

/** Renvoie `null` quand le hash ne peut pas donner un lien exploitable. */
export function ipfsUrl(hash: string) {
  const clean = toCid(hash);
  return CID_PATTERN.test(clean) ? `${ipfsGateway}/${clean}` : null;
}

export function campaignTitle(campaign: Campaign, metadata: Record<string, CampaignMetadata>) {
  return metadata[toCid(campaign.metadataHash)]?.name ?? `Campagne ${campaign.id}`;
}

/** Lien explorateur uniquement là où il existe un explorateur public. */
export function explorerTxUrl(hash: string) {
  return expectedChainId === 11155111n ? `https://sepolia.etherscan.io/tx/${hash}` : null;
}
