export type Campaign = {
  id: number;
  creator: string;
  beneficiary: string;
  goal: bigint;
  totalRaised: bigint;
  deadline: number;
  /** Statut calculé par `campaignStatus(id)` (tient compte de l'échéance). */
  status: number;
  /** Statut réellement stocké (`getCampaign(id).storedState`). */
  storedState: number;
  earlyReleaseApproved: boolean;
  metadataHash: string;
  contribution: bigint;
  tokensReleased: boolean;
};

export type Proposal = {
  id: number;
  campaignId: number;
  action: number;
  votesFor: bigint;
  votesAgainst: bigint;
  state: number;
  executed: boolean;
  snapshotBlock: number;
  deadlineBlock: number;
  executeAfterBlock: number;
  /** `quorum(id)` : voix exprimées minimales, figées au snapshot. */
  quorum: bigint;
  /** `majorityThreshold(id)` : CFD « Pour » requis (> 50 % de l'offre snapshot). */
  majorityThreshold: bigint;
  /** `getPastVotes(account, snapshotBlock)` : poids du compte connecté. */
  userWeight: bigint;
  /** URI IPFS du motif : le texte lui-même n'est plus stocké on-chain. */
  descriptionHash: string;
};

export type CampaignMetadata = {
  name?: string;
  description?: string;
  image?: string;
};

/** Dernier bloc connu du nœud : seule horloge fiable après `evm_increaseTime`. */
export type ChainHead = { number: number; timestamp: number };

export const CampaignState = {
  Active: 0,
  Successful: 1,
  Failed: 2,
  Frozen: 3,
  Cancelled: 4,
  PaidOut: 5,
} as const;

export const ProposalAction = {
  ApproveEarlyRelease: 0,
  FreezeCampaign: 1,
  ApproveRelease: 2,
} as const;

export const campaignStates = ["En cours", "Réussie", "Échouée", "Gelée", "Annulée", "Payée"];
export const proposalStates = ["Vote ouvert", "Rejetée", "Adoptée", "Exécutable", "Exécutée"];
export const actionNames = ["Déblocage anticipé", "Gel de campagne", "Validation du retrait final"];
