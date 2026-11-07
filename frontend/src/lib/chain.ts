import { Contract, id, JsonRpcProvider, JsonRpcSigner, ZeroAddress, ZeroHash } from "ethers";
import { addresses, coreAbi, governanceAbi, rpcUrl, tokenAbi, treasuryAbi } from "../contracts";

// Les lectures passent par le nœud, les signatures par le wallet.
export const readProvider = new JsonRpcProvider(rpcUrl);

export const coreReader = () => new Contract(addresses.core, coreAbi, readProvider);
export const tokenReader = () => new Contract(addresses.token, tokenAbi, readProvider);
export const governanceReader = () => new Contract(addresses.governance, governanceAbi, readProvider);
export const treasuryReader = () => new Contract(addresses.treasury, treasuryAbi, readProvider);

/**
 * Identifiants des rôles OpenZeppelin : `keccak256("NOM")`, sauf l'admin qui
 * vaut bytes32(0). Calculés localement plutôt que relus à chaque cycle.
 */
export const ROLES = {
  DEFAULT_ADMIN_ROLE: ZeroHash,
  PAUSER_ROLE: id("PAUSER_ROLE"),
  GOVERNANCE_ROLE: id("GOVERNANCE_ROLE"),
  MINTER_ROLE: id("MINTER_ROLE"),
  BURNER_ROLE: id("BURNER_ROLE"),
} as const;

export type RoleName = keyof typeof ROLES;

export function roleName(hash: string): string {
  const entry = Object.entries(ROLES).find(([, value]) => value.toLowerCase() === hash.toLowerCase());
  return entry ? entry[0] : `${hash.slice(0, 10)}…`;
}

/** Rôles existant réellement sur chaque contrat (cf. contracts/*.sol). */
export const CONTRACT_ROLES: Record<"core" | "token", RoleName[]> = {
  core: ["DEFAULT_ADMIN_ROLE", "PAUSER_ROLE", "GOVERNANCE_ROLE"],
  token: ["DEFAULT_ADMIN_ROLE", "MINTER_ROLE", "BURNER_ROLE", "PAUSER_ROLE"],
};

export type TxResponse = { hash: string; wait(): Promise<unknown> };
export type TxAction = (signer: JsonRpcSigner) => Promise<TxResponse>;
/** Signature de la fonction `sendTransaction` d'App : unique chemin d'écriture. */
export type SendTransaction = (label: string, action: TxAction) => Promise<boolean>;

// --- Administration ---------------------------------------------------------

export type AdminState = {
  corePaused: boolean;
  tokenPaused: boolean;
  /** Droits du compte connecté. */
  coreAdmin: boolean;
  corePauser: boolean;
  tokenAdmin: boolean;
  tokenPauser: boolean;
  /** Câblage attendu après déploiement. */
  coreIsMinter: boolean;
  coreIsBurner: boolean;
  governanceHasRole: boolean;
};

export const EMPTY_ADMIN: AdminState = {
  corePaused: false,
  tokenPaused: false,
  coreAdmin: false,
  corePauser: false,
  tokenAdmin: false,
  tokenPauser: false,
  coreIsMinter: false,
  coreIsBurner: false,
  governanceHasRole: false,
};

export async function loadAdminState(account: string): Promise<AdminState> {
  const core = coreReader();
  const token = tokenReader();
  const user = account || ZeroAddress;
  const results = (await Promise.all([
    core.paused(),
    token.paused(),
    account ? core.hasRole(ROLES.DEFAULT_ADMIN_ROLE, user) : false,
    account ? core.hasRole(ROLES.PAUSER_ROLE, user) : false,
    account ? token.hasRole(ROLES.DEFAULT_ADMIN_ROLE, user) : false,
    account ? token.hasRole(ROLES.PAUSER_ROLE, user) : false,
    token.hasRole(ROLES.MINTER_ROLE, addresses.core),
    token.hasRole(ROLES.BURNER_ROLE, addresses.core),
    core.hasRole(ROLES.GOVERNANCE_ROLE, addresses.governance),
  ])) as boolean[];
  const [corePaused, tokenPaused, coreAdmin, corePauser, tokenAdmin, tokenPauser, coreIsMinter, coreIsBurner, governanceHasRole] =
    results;
  return { corePaused, tokenPaused, coreAdmin, corePauser, tokenAdmin, tokenPauser, coreIsMinter, coreIsBurner, governanceHasRole };
}

// --- Jetons CFD ---------------------------------------------------------------

export type TokenState = {
  balance: bigint;
  locked: bigint;
  /** Voix (`getVotes`) : égales au solde, l'auto-délégation étant faite à la réception. */
  votes: bigint;
};

export const EMPTY_TOKEN: TokenState = { balance: 0n, locked: 0n, votes: 0n };

export async function loadTokenState(account: string): Promise<TokenState> {
  if (!account) return EMPTY_TOKEN;
  const token = tokenReader();
  const [balance, locked, votes] = (await Promise.all([
    token.balanceOf(account),
    token.lockedBalance(account),
    token.getVotes(account),
  ])) as [bigint, bigint, bigint];
  return { balance, locked, votes };
}

// --- Trésorerie multisig ------------------------------------------------------

export type TreasuryTransaction = {
  id: number;
  target: string;
  value: bigint;
  data: string;
  confirmations: number;
  required: number;
  executed: boolean;
  confirmedByMe: boolean;
};

export type TreasuryState = {
  balance: bigint;
  owners: string[];
  threshold: bigint;
  isOwner: boolean;
  transactions: TreasuryTransaction[];
};

export async function loadTreasuryState(account: string): Promise<TreasuryState> {
  const treasury = treasuryReader();
  const [balance, owners, threshold, isOwner, count] = await Promise.all([
    readProvider.getBalance(addresses.treasury),
    Promise.all([0, 1, 2].map((index) => treasury.owners(index) as Promise<string>)),
    treasury.largeWithdrawalThreshold() as Promise<bigint>,
    account ? (treasury.isOwner(account) as Promise<boolean>) : Promise.resolve(false),
    treasury.transactionCount() as Promise<bigint>,
  ]);

  const transactions = await Promise.all(
    Array.from({ length: Number(count) }, async (_, id): Promise<TreasuryTransaction> => {
      const raw = await treasury.getTransaction(id);
      const data = String(raw.data);
      // `data` est une chaîne hex « 0x… » : plus de 2 caractères = appel avec calldata.
      const [required, confirmedByMe] = await Promise.all([
        treasury.requiredConfirmations(raw.value, data.length > 2) as Promise<bigint>,
        account ? (treasury.isConfirmed(id, account) as Promise<boolean>) : Promise.resolve(false),
      ]);
      return {
        id,
        target: raw.target,
        value: raw.value,
        data,
        confirmations: Number(raw.confirmations),
        required: Number(required),
        executed: raw.executed,
        confirmedByMe,
      };
    }),
  );

  return { balance, owners, threshold, isOwner, transactions: transactions.reverse() };
}
