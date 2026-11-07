import { formatEther, Interface } from "ethers";
import { coreAbi, governanceAbi, tokenAbi, treasuryAbi } from "../contracts";
import { roleName } from "./chain";

/**
 * Les contrats signalent leurs refus par des erreurs custom (`revert FundsLocked()`).
 * Sans décodage, l'utilisateur ne voit qu'« execution reverted (unknown custom
 * error) » : on recherche donc les données de revert dans l'erreur, on les
 * décode avec les quatre ABI et on traduit le nom obtenu.
 */
const interfaces = [coreAbi, tokenAbi, governanceAbi, treasuryAbi].map((abi) => new Interface(abi));

type Args = readonly unknown[];

const MESSAGES: Record<string, string | ((args: Args) => string)> = {
  // OpenZeppelin
  AccessControlUnauthorizedAccount: (args) =>
    `Votre compte n’a pas le rôle requis${args[1] ? ` (${roleName(String(args[1]))})` : ""}.`,
  AccessControlBadConfirmation: "Confirmation de renonciation au rôle invalide.",
  EnforcedPause: "Contrat en pause : l’opération est suspendue par le circuit breaker.",
  ExpectedPause: "Le contrat n’est pas en pause.",
  ReentrancyGuardReentrantCall: "Appel réentrant refusé.",
  ERC20InsufficientBalance: "Solde CFD insuffisant.",
  ERC20InvalidReceiver: "Destinataire des CFD invalide.",
  ERC20InvalidSender: "Expéditeur des CFD invalide.",
  ERC5805FutureLookup: "Bloc demandé dans le futur : attendez le bloc suivant.",
  // CrowdfundingCore
  ZeroAddress: "Adresse nulle refusée.",
  InvalidGoal: "Objectif invalide.",
  InvalidDeadline: "Échéance invalide : elle doit être postérieure au dernier bloc.",
  InvalidTokenRate: "Taux de conversion CFD invalide.",
  CampaignNotFound: "Campagne introuvable.",
  CampaignNotActive: "La campagne n’est plus active.",
  CampaignClosed: "Campagne clôturée : échéance passée ou fonds déjà débloqués.",
  ContributionExceedsGoal: (args) =>
    `La contribution dépasse l’objectif. Montant maximal restant : ${formatEther(BigInt(String(args[0] ?? 0)))} ETH.`,
  ZeroContribution: "Le montant doit être supérieur à zéro.",
  NotBeneficiary: "Seul le bénéficiaire peut retirer les fonds.",
  FundsLocked: "Fonds verrouillés : une décision DAO exécutée est requise.",
  NothingToRefund: "Aucune contribution à rembourser pour ce compte.",
  RefundUnavailable: "Remboursement indisponible : la campagne n’est ni échouée, ni annulée, ni gelée.",
  TransferFailed: "Le transfert d’ETH a échoué.",
  AmountOverflow: "Montant trop élevé.",
  TokensAlreadyReleased: "Ces CFD sont déjà débloqués.",
  // CFDToken
  ContributionTokensLocked: "Ces CFD sont verrouillés tant que la contribution est remboursable.",
  // CampaignGovernance
  InvalidVotingPeriod: "Période de vote invalide.",
  InvalidQuorum: "Quorum invalide.",
  NoVotingPower: "Aucun CFD détenu au bloc du snapshot : contribuez avant la création de la proposition.",
  ProposalNotFound: "Proposition introuvable.",
  VotingClosed: "Le vote est clos pour cette proposition.",
  AlreadyVoted: "Vous avez déjà voté sur cette proposition.",
  VoteWeightOverflow: "Poids de vote hors limites.",
  ExecutionNotReady: "Exécution impossible : délai de blocs non écoulé ou proposition déjà exécutée.",
  ProposalDefeated: "Proposition rejetée : elle ne peut pas être exécutée.",
  EmptyDescriptionHash: "Le motif IPFS de la proposition est vide.",
  // MultiSigTreasury
  NotOwner: "Réservé aux propriétaires de la trésorerie multisig.",
  InvalidOwners: "Liste de propriétaires invalide.",
  InvalidTarget: "Adresse cible invalide.",
  TransactionNotFound: "Transaction multisig introuvable.",
  AlreadyConfirmed: "Vous avez déjà confirmé cette transaction.",
  NotConfirmed: "Vous n’avez pas confirmé cette transaction.",
  AlreadyExecuted: "Transaction déjà exécutée.",
  InsufficientConfirmations: "Confirmations insuffisantes pour exécuter ce retrait.",
  InsufficientBalance: "Solde de la trésorerie insuffisant.",
  ExecutionFailed: "L’appel vers la cible a échoué.",
  // Erreurs natives Solidity
  Error: (args) => `Transaction refusée : ${String(args[0] ?? "raison inconnue")}.`,
  Panic: (args) => `Erreur interne du contrat (panic ${String(args[0] ?? "?")}).`,
};

type Decoded = { name: string; args: Args };

/** Cherche une chaîne `data` hexadécimale dans l'arbre d'erreur ethers / MetaMask. */
function findRevertData(error: unknown, depth = 0): string | null {
  if (depth > 6 || error === null || typeof error !== "object") return null;
  const record = error as Record<string, unknown>;
  if (typeof record.data === "string" && /^0x[0-9a-fA-F]{8,}$/.test(record.data)) return record.data;
  // `payload` / `transaction` sont volontairement ignorés : leur `data` est le
  // calldata envoyé, pas la raison du refus.
  for (const key of ["data", "error", "info", "cause"]) {
    const nested = findRevertData(record[key], depth + 1);
    if (nested) return nested;
  }
  return null;
}

function decodeCustomError(error: unknown): Decoded | null {
  // Ethers décode déjà lorsque l'appel part d'un Contract qui connaît l'ABI.
  const revert = (error as { revert?: { name?: string; args?: Args } } | null)?.revert;
  if (revert?.name) return { name: revert.name, args: revert.args ? [...revert.args] : [] };

  const candidates = new Set<string>();
  const found = findRevertData(error);
  if (found) candidates.add(found);
  // Repli : certains wallets ne livrent les données qu'à l'intérieur du message.
  const message = error instanceof Error ? error.message : "";
  for (const match of message.matchAll(/0x[0-9a-fA-F]{8,}/g)) candidates.add(match[0]);

  for (const data of candidates) {
    for (const iface of interfaces) {
      try {
        const parsed = iface.parseError(data);
        if (parsed) return { name: parsed.name, args: [...parsed.args] };
      } catch {
        // Sélecteur inconnu de cette ABI : on essaie la suivante.
      }
    }
  }
  return null;
}

/**
 * Concatène tous les `message` de l'arbre d'erreur. MetaMask enfouit la raison
 * réelle sous plusieurs niveaux (`info.error.message`, `error.data.message`…) et
 * ethers n'en retient qu'un libellé générique — « could not coalesce error »
 * quand il n'a su classer aucun de ces niveaux.
 */
function collectMessages(error: unknown, depth = 0, seen = new Set<unknown>()): string {
  if (depth > 6 || error === null || typeof error !== "object" || seen.has(error)) return "";
  seen.add(error);
  const record = error as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof record.message === "string") parts.push(record.message);
  if (typeof record.reason === "string") parts.push(record.reason);
  for (const key of ["info", "error", "cause", "data", "value"]) {
    parts.push(collectMessages(record[key], depth + 1, seen));
  }
  return parts.filter(Boolean).join(" | ");
}

export function walletErrorMessage(error: unknown) {
  // Ethers enveloppe l'erreur EIP-1193 : le code brut est sous `info.error`.
  const wrapper = error as
    | { code?: number | string; info?: { error?: { code?: number } }; shortMessage?: string }
    | null;
  const code = wrapper?.info?.error?.code ?? wrapper?.code;

  if (code === 4001 || code === "ACTION_REJECTED") {
    return "Demande refusée dans MetaMask. Recliquez puis validez la fenêtre de l’extension.";
  }
  if (code === -32002) {
    return "Une demande MetaMask est déjà en attente : ouvrez l’extension pour la valider.";
  }

  const decoded = decodeCustomError(error);
  if (decoded) {
    const entry = MESSAGES[decoded.name];
    if (typeof entry === "function") return entry(decoded.args);
    if (entry) return entry;
    return `Refus du contrat : ${decoded.name}.`;
  }

  // Pannes d'environnement : elles ne viennent pas du contrat et ne portent donc
  // aucune donnée de revert à décoder. Sans ce bloc, l'utilisateur ne voyait que
  // le libellé interne d'ethers, qui n'indique pas quoi faire.
  const haystack = `${collectMessages(error)} ${wrapper?.shortMessage ?? ""}`.toLowerCase();

  if (/nonce (is )?too (high|low)|invalid nonce|nonce has already been used/.test(haystack)) {
    return (
      "Nonce désynchronisé : MetaMask a gardé l’historique d’une chaîne précédente. " +
      "Dans MetaMask, réseau Hardhat Local sélectionné : Paramètres › Avancé › « Effacer les données de l’onglet d’activité », puis rechargez la page."
    );
  }
  if (code === "INSUFFICIENT_FUNDS" || /insufficient funds|doesn't have enough funds/.test(haystack)) {
    return "Solde ETH insuffisant pour payer le montant et le gas sur ce compte.";
  }
  if (/failed to fetch|could not detect network|connection refused|econnrefused|network error/.test(haystack)) {
    return "Nœud injoignable : vérifiez que « npm run node » tourne et que MetaMask pointe sur le bon RPC.";
  }
  if (/chain id|chaindisconnected|unrecognized chain/.test(haystack)) {
    return "Réseau incorrect dans MetaMask : sélectionnez la chaîne du déploiement.";
  }

  // Dernier recours : ethers n'a pas su classer l'erreur. On remonte la raison
  // enfouie plutôt que son libellé interne, qui n'apprend rien à l'utilisateur.
  if (code === "UNKNOWN_ERROR" || wrapper?.shortMessage === "could not coalesce error") {
    const buried = collectMessages(error)
      .split(" | ")
      .find((part) => part && !/could not coalesce/i.test(part));
    return buried
      ? `Transaction refusée par MetaMask : ${buried}`
      : "Transaction refusée par MetaMask sans raison exploitable. Essayez « Effacer les données de l’onglet d’activité » dans Paramètres › Avancé, puis rechargez la page.";
  }

  if (wrapper?.shortMessage) return wrapper.shortMessage;
  return error instanceof Error ? error.message : "Connexion à MetaMask impossible.";
}
