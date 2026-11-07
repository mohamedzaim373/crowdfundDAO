import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrowserProvider, Contract, EventLog, formatEther, isAddress, parseEther, ZeroAddress } from "ethers";
import {
  addresses,
  expectedChainId,
  chainName as configuredChainName,
  coreAbi,
  deploymentBlock,
  ipfsGateway,
  isConfigured,
  rpcUrl,
  tokenAbi,
} from "./contracts";
import { isPinataConfigured, uploadImage, uploadMetadata } from "./pinata";
import Header from "./components/Header";
import Footer from "./components/Footer";
import { Help, HowItWorks, Trust } from "./components/Sections";
import AdminPanel from "./components/AdminPanel";
import TreasuryPanel from "./components/TreasuryPanel";
import TokenPanel from "./components/TokenPanel";
import ProposalCard from "./components/ProposalCard";
import ProposalForm from "./components/ProposalForm";
import {
  AdminState,
  coreReader,
  EMPTY_ADMIN,
  EMPTY_TOKEN,
  governanceReader,
  loadAdminState,
  loadTokenState,
  loadTreasuryState,
  readProvider,
  tokenReader,
  TokenState,
  TreasuryState,
  TxAction,
} from "./lib/chain";
import { walletErrorMessage } from "./lib/errors";
import {
  campaignTitle,
  CID_PATTERN,
  compactNumber,
  explorerTxUrl,
  formatEth,
  ipfsUrl,
  sameAddress,
  shortAddress,
  toCid,
} from "./lib/format";
import { Campaign, CampaignMetadata, campaignStates, ChainHead, Proposal } from "./types";

// Onglets de la section « Découvrez des campagnes » : même rôle que les
// catégories de GoFundMe, mais la seule taxonomie disponible on-chain est
// l'état de la campagne.
const FILTERS = [
  { id: "all", label: "Toutes les campagnes", match: () => true },
  { id: "open", label: "En cours", match: (campaign: Campaign) => campaign.status === 0 },
  { id: "funded", label: "Financées", match: (campaign: Campaign) => campaign.status === 1 || campaign.status === 5 },
  { id: "failed", label: "Échouées", match: (campaign: Campaign) => campaign.status === 2 },
  { id: "closed", label: "Gelées / annulées", match: (campaign: Campaign) => [3, 4].includes(campaign.status) },
] as const;

const PAGE_SIZE = 6;

function readString(source: Record<string, unknown>, key: string) {
  const value = source[key];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/**
 * La chaîne ne conserve qu'une empreinte : le contenu lisible d'une campagne
 * vit sur IPFS et doit être récupéré ici, sans quoi l'interface ne peut afficher
 * qu'un identifiant. Le document vient d'une source publique, donc chaque champ
 * est validé avant usage.
 */
async function fetchMetadata(cid: string, signal: AbortSignal): Promise<CampaignMetadata | null> {
  const response = await fetch(`${ipfsGateway}/${cid}`, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
  });
  if (!response.ok) return null;

  const parsed: unknown = await response.json();
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;

  const source = parsed as Record<string, unknown>;
  return {
    name: readString(source, "name"),
    description: readString(source, "description"),
    image: readString(source, "image"),
  };
}

const EXPECTED_CHAIN_ID = expectedChainId;

const HARDHAT_CHAIN = {
  chainId: `0x${expectedChainId.toString(16)}`,
  chainName: configuredChainName,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: [rpcUrl],
};

// Évite d'imposer la configuration manuelle du réseau : on demande la bascule,
// et si MetaMask ne connaît pas encore la chaîne (code 4902) on la déclare.
async function ensureHardhatNetwork(wallet: EthereumProvider) {
  try {
    await wallet.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: HARDHAT_CHAIN.chainId }],
    });
  } catch (error) {
    if ((error as { code?: number } | null)?.code !== 4902) throw error;
    await wallet.request({ method: "wallet_addEthereumChain", params: [HARDHAT_CHAIN] });
  }
}

// Plusieurs extensions (Phantom, Coinbase…) écrasent `window.ethereum` : la
// dernière injectée gagne. EIP-6963 laisse chaque wallet s'annoncer, ce qui
// permet de réclamer MetaMask explicitement au lieu de subir cet arbitrage.
function discoverMetaMask(): Promise<EthereumProvider | null> {
  return new Promise((resolve) => {
    let settled = false;
    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent<{
        info?: { rdns?: string };
        provider?: EthereumProvider;
      }>).detail;
      if (settled || detail?.info?.rdns !== "io.metamask" || !detail.provider) return;
      settled = true;
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      resolve(detail.provider);
    };

    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    // Repli sur l'injection historique si MetaMask ne s'annonce pas.
    window.setTimeout(() => {
      if (settled) return;
      settled = true;
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      resolve(window.ethereum ?? null);
    }, 1_000);
  });
}

function fundedPercent(campaign: Campaign) {
  return campaign.goal === 0n
    ? 0
    : Math.min(100, Number((campaign.totalRaised * 10_000n) / campaign.goal) / 100);
}

// Une campagne sans photo garde une couverture stable et colorée plutôt qu'un
// cadre vide : c'est la vignette qui donne envie de lire la suite.
// Teintes d'accent du design system GoFundMe (brand, feature, informative, tip,
// pink), assez foncées pour garder l'initiale blanche lisible.
const COVER_GRADIENTS = [
  "linear-gradient(135deg,#274A34,#4A9D44)",
  "linear-gradient(135deg,#1C456B,#185B93)",
  "linear-gradient(135deg,#68570D,#816D17)",
  "linear-gradient(135deg,#642878,#81379B)",
  "linear-gradient(135deg,#2D6339,#4A9D44)",
  "linear-gradient(135deg,#7E1946,#B01509)",
];

function CampaignCover({ campaign, meta }: { campaign: Campaign; meta?: CampaignMetadata }) {
  const [broken, setBroken] = useState(false);
  const imageUrl = meta?.image ? ipfsUrl(meta.image) : null;
  const title = meta?.name ?? `Campagne ${campaign.id}`;

  if (imageUrl && !broken) {
    // Le CID peut désigner autre chose qu'une image : on bascule sur la
    // couverture de repli au lieu d'afficher une vignette cassée.
    return <img className="cover" src={imageUrl} alt="" onError={() => setBroken(true)} />;
  }

  return (
    <div
      className="cover cover-fallback"
      style={{ backgroundImage: COVER_GRADIENTS[campaign.id % COVER_GRADIENTS.length] }}
      aria-hidden="true"
    >
      <span>{title.trim().slice(0, 1).toUpperCase()}</span>
    </div>
  );
}

export default function App() {
  const [account, setAccount] = useState("");
  const [chainName, setChainName] = useState("Non connecté");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [tokenState, setTokenState] = useState<TokenState>(EMPTY_TOKEN);
  const [admin, setAdmin] = useState<AdminState>(EMPTY_ADMIN);
  const [treasury, setTreasury] = useState<TreasuryState | null>(null);
  const [chainHead, setChainHead] = useState<ChainHead>({ number: 0, timestamp: 0 });
  const [lastTxHash, setLastTxHash] = useState("");
  const [notice, setNotice] = useState("Prêt à financer des idées vérifiables.");
  const [busy, setBusy] = useState(false);
  const [metadata, setMetadata] = useState<Record<string, CampaignMetadata>>({});
  const [donationCounts, setDonationCounts] = useState<Record<number, number>>({});
  const [votedProposals, setVotedProposals] = useState<Set<number>>(new Set());
  const requestedCids = useRef(new Set<string>());

  // État de la vitrine : recherche d'en-tête, onglet de catégorie et
  // pagination « Afficher plus d'éléments ».
  const [query, setQuery] = useState("");
  const [filterId, setFilterId] = useState<(typeof FILTERS)[number]["id"]>("all");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const [wallet, setWallet] = useState<EthereumProvider | null>(null);
  const [provider, setProvider] = useState<BrowserProvider | null>(null);

  // La découverte est asynchrone : les extensions s'annoncent après le montage.
  useEffect(() => {
    let cancelled = false;
    void discoverMetaMask().then((found) => {
      if (cancelled || !found) return;
      setWallet(found);
      setProvider(new BrowserProvider(found));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Un changement de réseau recharge la page : on restaure le compte déjà
  // autorisé au lieu de forcer un nouveau clic sur « Connecter ».
  useEffect(() => {
    if (!provider) return;
    void (async () => {
      const accounts = (await provider.send("eth_accounts", [])) as string[];
      if (accounts.length === 0) return;
      const network = await provider.getNetwork();
      setAccount(accounts[0]);
      setChainName(network.name === "unknown" ? `Chain ${network.chainId}` : network.name);
    })().catch(() => undefined);
  }, [provider]);

  const refresh = useCallback(async () => {
    if (!isConfigured) return;
    const core = coreReader();
    const governance = governanceReader();
    const [campaignCount, proposalCount, head, adminState, tokens, treasuryState] = await Promise.all([
      core.nextCampaignId().then(Number),
      governance.proposalCount().then(Number),
      readProvider.getBlock("latest"),
      loadAdminState(account),
      loadTokenState(account),
      loadTreasuryState(account),
    ]);

    const loadedCampaigns = await Promise.all(
      Array.from({ length: campaignCount }, async (_, id) => {
        const [raw, status, contribution, tokensReleased] = await Promise.all([
          core.getCampaign(id),
          core.campaignStatus(id),
          account ? core.contributions(id, account) : 0n,
          account ? core.votingTokensReleased(id, account) : false,
        ]);
        return {
          id,
          creator: raw.creator,
          beneficiary: raw.beneficiary,
          goal: raw.goal,
          totalRaised: raw.totalRaised,
          deadline: Number(raw.deadline),
          status: Number(status),
          storedState: Number(raw.storedState),
          earlyReleaseApproved: raw.earlyReleaseApproved,
          metadataHash: raw.metadataHash,
          contribution,
          tokensReleased,
        } satisfies Campaign;
      }),
    );

    const token = tokenReader();
    const loadedProposals = await Promise.all(
      Array.from({ length: proposalCount }, async (_, index) => {
        const id = index + 1;
        const [raw, state, quorum, majorityThreshold] = await Promise.all([
          governance.getProposal(id),
          governance.state(id),
          governance.quorum(id) as Promise<bigint>,
          governance.majorityThreshold(id) as Promise<bigint>,
        ]);
        // Le poids d'un vote est celui du compte AU snapshot, pas son solde actuel.
        const userWeight: bigint = account ? await token.getPastVotes(account, raw.snapshotBlock) : 0n;
        return {
          id,
          campaignId: Number(raw.campaignId),
          action: Number(raw.action),
          votesFor: raw.votesFor,
          votesAgainst: raw.votesAgainst,
          state: Number(state),
          executed: raw.executed,
          snapshotBlock: Number(raw.snapshotBlock),
          deadlineBlock: Number(raw.deadlineBlock),
          executeAfterBlock: Number(raw.executeAfterBlock),
          quorum,
          majorityThreshold,
          userWeight,
          descriptionHash: raw.descriptionHash,
        } satisfies Proposal;
      }),
    );

    setCampaigns(loadedCampaigns.reverse());
    setProposals(loadedProposals.reverse());
    if (head) setChainHead({ number: head.number, timestamp: head.timestamp });
    setAdmin(adminState);
    setTokenState(tokens);
    setTreasury(treasuryState);

    // Le nombre de dons n'est pas stocké dans la structure de campagne : il se
    // reconstitue depuis les évènements, à partir du bloc de déploiement. Un RPC
    // public peut refuser une plage trop large, auquel cas le compteur est masqué.
    try {
      const logs = await core.queryFilter(core.filters.ContributionReceived(), deploymentBlock);
      const counts: Record<number, number> = {};
      for (const log of logs) {
        const args = (log as EventLog).args;
        if (!args) continue;
        const id = Number(args.campaignId);
        counts[id] = (counts[id] ?? 0) + 1;
      }
      setDonationCounts(counts);
    } catch {
      setDonationCounts({});
    }

    if (account) {
      // Un second vote serait rejeté par le contrat : on désactive les boutons
      // plutôt que de laisser partir une transaction perdue.
      const voted = await Promise.all(
        loadedProposals.map((proposal) => governance.hasVoted(proposal.id, account) as Promise<boolean>),
      );
      setVotedProposals(
        new Set(loadedProposals.filter((_, index) => voted[index]).map((proposal) => proposal.id)),
      );
    } else {
      setVotedProposals(new Set());
    }
  }, [account]);

  useEffect(() => {
    let running = false;
    const update = async () => {
      if (running) return;
      running = true;
      try { await refresh(); } catch (error) { setNotice(walletErrorMessage(error)); }
      finally { running = false; }
    };
    void update();
    const timer = window.setInterval(() => void update(), 4000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  // Campagnes et propositions pointent toutes deux vers un document IPFS :
  // elles partagent donc le même cache et le même mécanisme de récupération.
  const metadataCids = [
    ...new Set([
      ...campaigns.map((campaign) => toCid(campaign.metadataHash)),
      ...proposals.map((proposal) => toCid(proposal.descriptionHash)),
    ]),
  ]
    .sort()
    .join("|");

  // Un CID n'est demandé qu'une fois ; en cas d'échec il est retiré du registre
  // pour être retenté au prochain rafraîchissement.
  useEffect(() => {
    const controller = new AbortController();

    for (const cid of metadataCids.split("|")) {
      if (!CID_PATTERN.test(cid) || requestedCids.current.has(cid)) continue;

      requestedCids.current.add(cid);
      void fetchMetadata(cid, controller.signal)
        .then((loaded) => {
          if (loaded) setMetadata((current) => ({ ...current, [cid]: loaded }));
        })
        .catch(() => {
          requestedCids.current.delete(cid);
        });
    }

    return () => controller.abort();
  }, [metadataCids]);

  // MetaMask changes the active account or network without reloading the page,
  // so mirror both instead of leaving the interface on stale data.
  useEffect(() => {
    if (!wallet?.on) return;

    const onAccountsChanged = (...args: unknown[]) => {
      const [accounts] = args as [string[]];
      setAccount(accounts[0] ?? "");
      setTokenState(EMPTY_TOKEN);
      // Les droits de l'ancien compte ne doivent pas rester affichés le temps
      // du prochain rafraîchissement.
      setAdmin((current) => ({ ...current, coreAdmin: false, corePauser: false, tokenAdmin: false, tokenPauser: false }));
      setNotice(accounts[0] ? "Compte MetaMask changé." : "Wallet déconnecté.");
    };
    const onChainChanged = () => window.location.reload();

    wallet.on("accountsChanged", onAccountsChanged);
    wallet.on("chainChanged", onChainChanged);
    return () => {
      wallet.removeListener?.("accountsChanged", onAccountsChanged);
      wallet.removeListener?.("chainChanged", onChainChanged);
    };
  }, [wallet]);

  async function connectWallet() {
    if (!provider) {
      setNotice("MetaMask n’est pas disponible dans ce navigateur.");
      return;
    }
    setBusy(true);
    try {
      const accounts = (await provider.send("eth_requestAccounts", [])) as string[];
      if (accounts.length === 0) {
        setNotice("Aucun compte sélectionné dans MetaMask.");
        return;
      }
      let network = await provider.getNetwork();
      if (network.chainId !== EXPECTED_CHAIN_ID && wallet) {
        setNotice(`Bascule vers le réseau ${configuredChainName}…`);
        await ensureHardhatNetwork(wallet);
        network = await provider.getNetwork();
      }
      setAccount(accounts[0]);
      setChainName(network.name === "unknown" ? `Chain ${network.chainId}` : network.name);
      setNotice(
        network.chainId === EXPECTED_CHAIN_ID
          ? "Wallet connecté. Les données on-chain sont à jour."
          : `Mauvais réseau (chaîne ${network.chainId}) : sélectionnez ${configuredChainName}, chaîne ${expectedChainId}.`,
      );
    } catch (error) {
      // Sans ce catch, un refus dans MetaMask laissait le bouton muet.
      setNotice(walletErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function sendTransaction(label: string, action: TxAction) {
    if (!provider) {
      setNotice("MetaMask n’est pas disponible dans ce navigateur.");
      return false;
    }
    setBusy(true);
    setLastTxHash("");
    setNotice(`${label} — confirmation MetaMask…`);
    try {
      // Les lectures viennent du nœud, pas du wallet : l'interface reste donc
      // utilisable même si MetaMask pointe ailleurs. Sans ce garde-fou, une
      // contribution partirait sur le réseau actif du wallet — mainnet compris —
      // vers une adresse qui n'y héberge aucun contrat.
      const network = await provider.getNetwork();
      if (network.chainId !== EXPECTED_CHAIN_ID) {
        setNotice(
          `${label} annulé : MetaMask est sur la chaîne ${network.chainId}. ` +
            `Cliquez sur « Connecter MetaMask » pour basculer sur ${configuredChainName} (${expectedChainId}).`,
        );
        return false;
      }

      const signer = await provider.getSigner();
      const transaction = await action(signer);
      setLastTxHash(transaction.hash);
      setNotice(`${label} — transaction envoyée…`);
      await transaction.wait();
      setNotice(`${label} — confirmé sur la blockchain.`);
      await refresh();
      return true;
    } catch (error) {
      setNotice(walletErrorMessage(error));
      return false;
    } finally {
      setBusy(false);
    }
  }

  /**
   * Publie les métadonnées puis crée la campagne. Quand Pinata est configuré,
   * l'utilisateur décrit son projet dans le formulaire et l'upload est fait
   * ici ; sinon il colle lui-même un CID déjà publié.
   */
  async function createCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // `event.currentTarget` is nulled once the dispatch ends, so keep the node
    // before awaiting the transaction.
    const element = event.currentTarget;
    const form = new FormData(element);
    const goal = String(form.get("goal"));
    const days = Number(form.get("days"));
    const beneficiary = String(form.get("beneficiary") ?? "").trim() || account;
    // Contrôlée avant tout upload IPFS : une adresse fautive ferait échouer la
    // transaction après publication, laissant une fiche orpheline.
    if (!isAddress(beneficiary) || beneficiary === ZeroAddress) {
      setNotice("Adresse du bénéficiaire invalide : saisissez une adresse Ethereum (0x… sur 40 caractères hexadécimaux).");
      return;
    }

    let metadataUri = String(form.get("metadata") ?? "");

    if (isPinataConfigured) {
      // L'upload précède la transaction : un échec ici doit laisser le
      // formulaire intact plutôt que de créer une campagne sans contenu.
      setBusy(true);
      try {
        const image = form.get("image");
        let imageCid: string | undefined;
        if (image instanceof File && image.size > 0) {
          setNotice("Publication de l’image sur IPFS…");
          imageCid = await uploadImage(image);
        }

        setNotice("Publication de la fiche de campagne sur IPFS…");
        const cid = await uploadMetadata({
          name: String(form.get("name")),
          description: String(form.get("description")),
          category: String(form.get("category")),
          image: imageCid,
        });
        metadataUri = `ipfs://${cid}`;
      } catch (error) {
        setNotice(
          `Publication IPFS impossible : ${error instanceof Error ? error.message : "erreur inconnue"}`,
        );
        return;
      } finally {
        setBusy(false);
      }
    }

    const success = await sendTransaction("Création de la campagne", async (signer) => {
      // L'échéance part de l'horloge de la chaîne, pas de Date.now() : après un
      // evm_increaseTime, l'heure locale serait déjà dans le passé du contrat.
      const head = await readProvider.getBlock("latest");
      const now = head?.timestamp ?? Math.floor(Date.now() / 1000);
      const deadline = now + days * 86_400;
      const core = new Contract(addresses.core, coreAbi, signer);
      return core.createCampaign(parseEther(goal), deadline, beneficiary, metadataUri);
    });
    if (success) element.reset();
  }

  async function contribute(event: FormEvent<HTMLFormElement>, campaignId: number) {
    event.preventDefault();
    const element = event.currentTarget;
    const amount = String(new FormData(element).get("amount"));
    const success = await sendTransaction(`Contribution à la campagne #${campaignId}`, async (signer) => {
      const core = new Contract(addresses.core, coreAbi, signer);
      return core.contribute(campaignId, { value: parseEther(amount) });
    });
    if (success) element.reset();
  }

  const raised = campaigns.reduce((sum, campaign) => sum + campaign.totalRaised, 0n);
  const activeCount = campaigns.filter((campaign) => campaign.status === 0).length;
  const totalDonations = Object.values(donationCounts).reduce((sum, count) => sum + count, 0);
  // La vedette va à la campagne en cours la plus avancée : celle qui a le plus
  // de chances d'aboutir si un visiteur la complète.
  const featured = campaigns
    .filter((campaign) => campaign.status === 0)
    .sort((a, b) => fundedPercent(b) - fundedPercent(a))[0];

  // La recherche porte sur le titre et le texte venus d'IPFS, et sur
  // l'identifiant on-chain pour retrouver une campagne précise.
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filter = FILTERS.find((entry) => entry.id === filterId) ?? FILTERS[0];
    return campaigns.filter((campaign) => {
      if (!filter.match(campaign)) return false;
      if (!needle) return true;
      const meta = metadata[toCid(campaign.metadataHash)];
      const haystack = [
        meta?.name ?? `Campagne ${campaign.id}`,
        meta?.description ?? "",
        `#${campaign.id}`,
        campaign.beneficiary,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [campaigns, filterId, metadata, query]);

  // Changer d'onglet ou de recherche doit repartir de la première page.
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [filterId, query]);

  const visible = filtered.slice(0, visibleCount);

  // Confort d'affichage seulement : le contrat reste seul juge des droits.
  const isAdmin = admin.coreAdmin || admin.corePauser || admin.tokenAdmin || admin.tokenPauser;
  // Horloge de la chaîne (dernier bloc) : reste juste après evm_increaseTime.
  const chainNow = chainHead.timestamp || Math.floor(Date.now() / 1000);
  // Une contribution émet des CFD : la pause du Token la bloque aussi.
  const contributionsPaused = admin.corePaused || admin.tokenPaused;
  const txUrl = lastTxHash ? explorerTxUrl(lastTxHash) : null;

  return (
    <>
      <Header
        account={account}
        busy={busy}
        query={query}
        onQueryChange={setQuery}
        onConnect={connectWallet}
        shortAddress={shortAddress}
        showAdmin={isAdmin}
      />

      {(admin.corePaused || admin.tokenPaused) && (
        <div className="pause-banner" role="alert">
          <b>⏸ Circuit breaker activé.</b>{" "}
          {admin.corePaused && admin.tokenPaused
            ? "Le Core et le jeton CFD sont en pause : contributions, retraits, remboursements, créations de campagne et transferts de CFD sont suspendus."
            : admin.corePaused
              ? "Le Core est en pause : contributions, retraits, remboursements et créations de campagne sont suspendus."
              : "Le jeton CFD est en pause : les transferts de CFD et les contributions (qui émettent des CFD) sont suspendus. Les remboursements restent possibles."}
        </div>
      )}

      <main>
        <section className="hero" id="top">
          <div className="hero-inner">
            <div className="hero-copy">
              <p className="eyebrow"><span>◆</span> {activeCount} campagne{activeCount > 1 ? "s" : ""} attend{activeCount > 1 ? "ent" : ""} votre soutien</p>
              <h1>Le point de départ des <em>campagnes</em> à succès.</h1>
              <p className="lede">
                Chaque contribution est versée directement au projet, sans intermédiaire.
                Vous recevez des jetons CFD qui vous donnent voix au chapitre sur
                l’utilisation des fonds.
              </p>
              <div className="hero-actions">
                <a className="primary" href="#launch">Créer une campagne <span>→</span></a>
                <a className="secondary" href="#campaigns">Faire un don</a>
              </div>
              <p className="cta-note">Aucun frais de plateforme pour commencer à collecter des fonds.</p>
              <div className="trust-line">
                <span>✓ Fonds bloqués par contrat</span>
                <span>✓ Remboursé si l’objectif échoue</span>
                <span>✓ Décisions votées par les donateurs</span>
              </div>
            </div>

            <aside className="hero-feature">
              {featured ? (
                <article className="feature-card">
                  <div className="cover-wrap">
                    <CampaignCover campaign={featured} meta={metadata[toCid(featured.metadataHash)]} />
                    <span className="feature-flag">● En vedette</span>
                    {donationCounts[featured.id] > 0 && (
                      <span className="donation-count">{compactNumber.format(donationCounts[featured.id])} dons</span>
                    )}
                  </div>
                  <div className="card-body">
                    <h3>{metadata[toCid(featured.metadataHash)]?.name ?? `Campagne ${featured.id}`}</h3>
                    <div className="progress">
                      <span style={{ width: `${fundedPercent(featured)}%` }} />
                    </div>
                    <div className="funding-row">
                      <b>{formatEth(featured.totalRaised)} ETH</b>
                      <span>sur {formatEth(featured.goal)} ETH · {fundedPercent(featured).toFixed(0)}%</span>
                    </div>
                    <a className="primary wide" href="#campaigns">Soutenir ce projet</a>
                  </div>
                </article>
              ) : (
                <article className="feature-card feature-empty">
                  <div className="cover cover-fallback" style={{ backgroundImage: COVER_GRADIENTS[0] }}>
                    <span>+</span>
                  </div>
                  <div className="card-body">
                    <h3>Votre projet ici</h3>
                    <p className="campaign-description">
                      Aucune campagne en cours. Lancez la prochaine et donnez-lui
                      une chance d’être financée.
                    </p>
                    <a className="primary wide" href="#launch">Lancer une campagne</a>
                  </div>
                </article>
              )}
            </aside>
          </div>
        </section>

        {/* Reprise de la promesse chiffrée « Plus de 45 millions d'euros sont
            collectés chaque semaine », mais alimentée par l'état réel du
            contrat au lieu d'une moyenne marketing. */}
        <section className="stat-claim">
          <h2>
            {formatEth(raised, 2)} ETH ont déjà été collectés sur Crowdfund DAO
            {totalDonations > 0 && <> par {compactNumber.format(totalDonations)} dons</>}
            <sup>*</sup>
          </h2>
          <p>
            Lancez-vous en quelques minutes. Fixez un objectif, publiez vos
            détails sur IPFS et partagez le lien : le contrat se charge du reste.
          </p>
        </section>

        <section className="metrics" id="metrics">
          <article><span>Volume financé</span><strong>{formatEth(raised, 2)} ETH</strong></article>
          <article><span>Projets publics</span><strong>{campaigns.length}</strong></article>
          <article><span>Propositions DAO</span><strong>{proposals.length}</strong></article>
          <article><span>Votre pouvoir de vote</span><strong>{formatEth(tokenState.votes, 1)} voix</strong></article>
        </section>

        {!isConfigured && (
          <section className="config-warning">
            <b>Configuration requise</b>
            <span>Copiez <code>frontend/.env.example</code> vers <code>frontend/.env</code>, puis ajoutez les adresses du déploiement.</span>
          </section>
        )}

        <HowItWorks />

        <section className="section" id="campaigns">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Opportunités ouvertes</p>
              <h2>Découvrez des campagnes à soutenir</h2>
            </div>
            <span className="network-chip">● {chainName}</span>
          </div>

          <div className="tabs" role="group" aria-label="Filtrer les campagnes">
            {FILTERS.map((filter) => {
              const count = campaigns.filter(filter.match).length;
              return (
                <button
                  className="tab"
                  key={filter.id}
                  aria-pressed={filterId === filter.id}
                  onClick={() => setFilterId(filter.id)}
                >
                  {filter.label}
                  <span className="tab-count">{count}</span>
                </button>
              );
            })}
          </div>

          <div className="campaign-grid">
            {filtered.length === 0 && (
              <div className="empty">
                {campaigns.length === 0
                  ? "Aucune campagne déployée pour le moment."
                  : "Aucune campagne ne correspond à cette recherche."}
              </div>
            )}
            {visible.map((campaign) => {
              const percentage = fundedPercent(campaign);
              // Mirrors CrowdfundingCore: Failed, Cancelled and Frozen campaigns refund,
              // and the beneficiary withdraws once successful or after an early release.
              const refundable = [2, 3, 4].includes(campaign.status);
              const withdrawable =
                campaign.status === 1 && campaign.earlyReleaseApproved;
              const isBeneficiary = account.toLowerCase() === campaign.beneficiary.toLowerCase();
              const meta = metadata[toCid(campaign.metadataHash)];
              const daysLeft = Math.ceil((campaign.deadline - chainNow) / 86_400);
              const donations = donationCounts[campaign.id] ?? 0;
              const remaining = campaign.goal > campaign.totalRaised ? campaign.goal - campaign.totalRaised : 0n;
              return (
                <article className="campaign-card" key={campaign.id}>
                  <div className="cover-wrap">
                    <CampaignCover campaign={campaign} meta={meta} />
                    <span className={`status status-${campaign.status}`}>{campaignStates[campaign.status]}</span>
                    {donations > 0 && (
                      <span className="donation-count">{compactNumber.format(donations)} dons</span>
                    )}
                  </div>

                  <div className="card-body">
                    <h3>{meta?.name ?? `Campagne ${campaign.id}`}</h3>
                    {meta?.description && <p className="campaign-description">{meta.description}</p>}

                    <div className="progress"><span style={{ width: `${percentage}%` }} /></div>
                    <div className="funding-row">
                      <b>{formatEth(campaign.totalRaised)} ETH</b>
                      <span>de dons récoltés sur {formatEth(campaign.goal)} ETH</span>
                    </div>
                    <p className="urgency">
                      {campaign.status === 0 && daysLeft > 0
                        ? `${percentage.toFixed(0)}% atteint · ${daysLeft} jour${daysLeft > 1 ? "s" : ""} restant${daysLeft > 1 ? "s" : ""}`
                        : campaign.status === 1 && campaign.totalRaised >= campaign.goal
                          ? "100% atteint · contributions clôturées"
                          : `${percentage.toFixed(0)}% atteint · campagne clôturée`}
                    </p>

                    {campaign.status === 1 && campaign.totalRaised >= campaign.goal && (
                      <div className="success-note" role="status">
                        <strong>Objectif atteint.</strong>
                        <span>Les contributions sont fermées. Le retrait reste soumis à la validation de la DAO.</span>
                      </div>
                    )}

                    {campaign.status === 2 && (
                      <div className="failure-note" role="status">
                        <strong>Objectif non atteint.</strong>
                        {account && campaign.contribution > 0n ? (
                          <span>
                            Vous pouvez récupérer <b>{formatEth(campaign.contribution)} ETH</b>. Les CFD
                            correspondants seront détruits lors du remboursement.
                          </span>
                        ) : (
                          <span>
                            Chaque contributeur peut récupérer intégralement sa contribution depuis son
                            propre portefeuille.
                          </span>
                        )}
                      </div>
                    )}

                    {campaign.status === 0 && remaining > 0n && (
                      <form className="inline-form" onSubmit={(event) => contribute(event, campaign.id)}>
                        <label><input name="amount" type="number" min="0.001" max={formatEther(remaining)} step="0.001" placeholder="0.10" required /><span>ETH</span></label>
                        <button disabled={!account || busy || !isConfigured || contributionsPaused || remaining === 0n}>Je participe</button>
                      </form>
                    )}
                    {campaign.status === 0 && contributionsPaused && (
                      <p className="paused-note">Contributions suspendues : contrat en pause.</p>
                    )}
                    {refundable && account && campaign.contribution > 0n && (
                      <button className="wide-secondary" disabled={busy || admin.corePaused} onClick={() => sendTransaction("Remboursement", async (signer) => new Contract(addresses.core, coreAbi, signer).refund(campaign.id))}>Récupérer {formatEth(campaign.contribution)} ETH</button>
                    )}
                    {campaign.status === 1 && !campaign.earlyReleaseApproved && <p>Retrait en attente de validation par la DAO.</p>}
                    {campaign.status === 5 && campaign.contribution > 0n && !campaign.tokensReleased && (
                      <button className="wide-secondary" disabled={busy} onClick={() => sendTransaction("Déblocage des CFD", async signer => new Contract(addresses.core, coreAbi, signer).releaseContributionTokens(campaign.id, account))}>Rendre mes CFD transférables</button>
                    )}
                    {withdrawable && isBeneficiary && (
                      <button className="wide-secondary" disabled={busy || admin.corePaused} onClick={() => sendTransaction("Retrait des fonds", async (signer) => new Contract(addresses.core, coreAbi, signer).withdrawFunds(campaign.id))}>Retirer les fonds</button>
                    )}

                    <div className="campaign-meta">
                      <span>Bénéficiaire <b>{shortAddress(campaign.beneficiary)}</b></span>
                      <span>Échéance <b>{new Date(campaign.deadline * 1000).toLocaleDateString("fr-FR")}</b></span>
                    </div>

                    {(() => {
                      const href = ipfsUrl(campaign.metadataHash);
                      // Un hash hors format ne donnerait qu'une erreur de passerelle :
                      // on l'affiche alors en clair plutôt qu'en lien cassé.
                      return href ? (
                        <a className="ipfs" href={href} target="_blank" rel="noreferrer">
                          Vérifier les métadonnées sur IPFS ↗
                        </a>
                      ) : (
                        <span className="ipfs" title="Hash IPFS absent ou mal formé">
                          Métadonnées IPFS indisponibles
                        </span>
                      );
                    })()}
                  </div>
                </article>
              );
            })}
          </div>

          {filtered.length > visible.length && (
            <button className="load-more" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>
              Afficher plus d'éléments ({filtered.length - visible.length})
            </button>
          )}
        </section>

        {account && isConfigured && (
          <TokenPanel
            token={tokenState}
            tokenPaused={admin.tokenPaused}
            busy={busy}
            sendTransaction={sendTransaction}
          />
        )}

        <section className="governance" id="governance">
          <div className="section-heading light">
            <div><p className="eyebrow">Une voix proportionnelle, un historique immuable</p><h2>Décisions de la DAO</h2></div>
          </div>
          <div className="governance-layout">
            <div className="proposal-list">
              {proposals.length === 0 && <div className="empty dark">Aucune proposition active.</div>}
              {proposals.map((proposal) => {
                const campaign = campaigns.find((entry) => entry.id === proposal.campaignId);
                return (
                  <ProposalCard
                    key={proposal.id}
                    proposal={proposal}
                    currentBlock={chainHead.number}
                    account={account}
                    busy={busy}
                    alreadyVoted={votedProposals.has(proposal.id)}
                    motive={metadata[toCid(proposal.descriptionHash)]?.description}
                    motiveUrl={ipfsUrl(proposal.descriptionHash)}
                    campaignLabel={campaign ? `#${campaign.id} ${campaignTitle(campaign, metadata)}` : `campagne #${proposal.campaignId}`}
                    sendTransaction={sendTransaction}
                  />
                );
              })}
            </div>
            <ProposalForm
              account={account}
              campaigns={campaigns}
              metadata={metadata}
              chainTime={chainNow}
              votes={tokenState.votes}
              busy={busy}
              setBusy={setBusy}
              setNotice={setNotice}
              sendTransaction={sendTransaction}
            />
          </div>
        </section>

        {isConfigured && (
          <TreasuryPanel account={account} treasury={treasury} busy={busy} sendTransaction={sendTransaction} />
        )}

        <section className="launch" id="launch">
          <div>
            <p className="eyebrow">Transformer une vision en engagement collectif</p>
            <h2>Lancer une campagne</h2>
            <p>
              {isPinataConfigured
                ? "Décrivez votre projet : l’image et la fiche sont publiées sur IPFS, et seule leur empreinte immuable est conservée on-chain."
                : "Les détails du projet restent sur IPFS. Seule leur empreinte immuable est conservée on-chain."}
            </p>
          </div>
          <form onSubmit={createCampaign}>
            {/* Les champs restent visibles même sans jeton : ils décrivent le
                parcours réel. Désactivés, ils annoncent ce qui s'active une fois
                la clé renseignée, au lieu de laisser croire que coller un CID à
                la main est la façon normale de publier. */}
            <label className="wide">Titre du projet<input name="name" maxLength={120} placeholder="Panneaux solaires pour l’école de Tadla" required={isPinataConfigured} disabled={!isPinataConfigured} /></label>
            <label className="wide">Description<textarea name="description" rows={4} maxLength={1200} placeholder="Ce que les fonds financent, et comment le vérifier…" required={isPinataConfigured} disabled={!isPinataConfigured} /></label>
            <label>Catégorie
              <select name="category" defaultValue="autre" disabled={!isPinataConfigured}>
                <option value="energie">Énergie</option>
                <option value="sante">Santé</option>
                <option value="education">Éducation</option>
                <option value="urgence">Urgence</option>
                <option value="autre">Autre</option>
              </select>
            </label>
            <label>Image de couverture<input name="image" type="file" accept="image/*" disabled={!isPinataConfigured} /></label>

            {!isPinataConfigured && (
              <div className="form-warning wide">
                <b>Publication automatique désactivée</b>
                <p>
                  Ajoutez <code>VITE_PINATA_JWT</code> dans <code>frontend/.env</code> pour
                  que l’application publie elle-même le texte et l’image sur IPFS. En
                  attendant, collez le CID d’une fiche déjà publiée.
                </p>
                <label>Hash IPFS<input name="metadata" placeholder="ipfs://bafy…" required /></label>
              </div>
            )}

            <label>Objectif<input name="goal" type="number" min="0.01" step="0.01" placeholder="10" required /><span>ETH</span></label>
            <label>Durée<input name="days" type="number" min="1" max="365" placeholder="30" required /><span>jours</span></label>
            <label className="wide">Bénéficiaire<input name="beneficiary" placeholder={account || ZeroAddress} /></label>
            {admin.corePaused && <p className="paused-note wide">Création de campagne suspendue : le Core est en pause.</p>}
            <button className="wide" disabled={!account || busy || !isConfigured || admin.corePaused}>Publier la campagne <span>↗</span></button>
          </form>
        </section>

        {isAdmin && isConfigured && (
          <AdminPanel
            account={account}
            admin={admin}
            campaigns={campaigns}
            metadata={metadata}
            busy={busy}
            sendTransaction={sendTransaction}
          />
        )}

        <Help />
        <Trust />
      </main>

      <div className="notice" role="status">
        <span className={busy ? "spinner" : "notice-dot"} />
        <span className="notice-text">{notice}</span>
        {lastTxHash &&
          (txUrl ? (
            <a className="notice-hash" href={txUrl} target="_blank" rel="noreferrer" title={lastTxHash}>
              tx {shortAddress(lastTxHash)} ↗
            </a>
          ) : (
            <code className="notice-hash" title={lastTxHash}>tx {shortAddress(lastTxHash)}</code>
          ))}
      </div>
      <Footer chainName={chainName} />
    </>
  );
}
