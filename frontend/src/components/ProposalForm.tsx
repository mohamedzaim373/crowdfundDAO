import { FormEvent, useEffect, useMemo, useState } from "react";
import { Contract } from "ethers";
import { addresses, governanceAbi, isConfigured } from "../contracts";
import { SendTransaction } from "../lib/chain";
import { campaignTitle } from "../lib/format";
import { isPinataConfigured, uploadProposalMotive } from "../pinata";
import { actionNames, Campaign, CampaignMetadata, CampaignState, campaignStates, ProposalAction } from "../types";

type Props = {
  account: string;
  campaigns: Campaign[];
  metadata: Record<string, CampaignMetadata>;
  /** Horodatage du dernier bloc (secondes). */
  chainTime: number;
  votes: bigint;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  setNotice: (notice: string) => void;
  sendTransaction: SendTransaction;
};

/**
 * Raison pour laquelle une action serait refusée à l'exécution, ou `null`.
 * Reproduit les gardes de CrowdfundingCore (approveEarlyRelease,
 * freezeCampaign, approveRelease) pour éviter un vote voué à l'échec.
 */
function actionBlocker(campaign: Campaign | undefined, action: number, chainTime: number): string | null {
  if (!campaign) return "Choisissez une campagne";
  switch (action) {
    case ProposalAction.ApproveRelease:
      if (campaign.status !== CampaignState.Successful) return "campagne non réussie";
      if (campaign.earlyReleaseApproved) return "retrait déjà approuvé";
      return null;
    case ProposalAction.ApproveEarlyRelease:
      if (campaign.status !== CampaignState.Active) return "campagne non active";
      if (chainTime >= campaign.deadline) return "échéance dépassée";
      return null;
    case ProposalAction.FreezeCampaign:
      return campaign.storedState === CampaignState.Active ? null : "statut stocké non actif";
    default:
      return "action inconnue";
  }
}

export default function ProposalForm({
  account,
  campaigns,
  metadata,
  chainTime,
  votes,
  busy,
  setBusy,
  setNotice,
  sendTransaction,
}: Props) {
  const [campaignId, setCampaignId] = useState("");
  const [action, setAction] = useState<number>(ProposalAction.ApproveEarlyRelease);

  const selected = campaigns.find((campaign) => String(campaign.id) === campaignId);
  const blockers = useMemo(
    () => actionNames.map((_, index) => actionBlocker(selected, index, chainTime)),
    [selected, chainTime],
  );

  // Présélectionne la première campagne, puis bascule sur une action valide
  // quand la campagne choisie change d'état.
  useEffect(() => {
    if (!selected && campaigns[0]) setCampaignId(String(campaigns[0].id));
  }, [campaigns, selected]);
  useEffect(() => {
    if (blockers[action] === null) return;
    const firstAllowed = blockers.findIndex((blocker) => blocker === null);
    if (firstAllowed !== -1) setAction(firstAllowed);
  }, [action, blockers]);

  const hasVotes = votes > 0n;
  const actionAllowed = blockers[action] === null;

  /**
   * Le contrat ne conserve qu'une empreinte du motif : il faut donc publier le
   * texte sur IPFS avant de soumettre la proposition.
   */
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !actionAllowed) return;
    const element = event.currentTarget;
    const form = new FormData(element);
    let descriptionHash = String(form.get("descriptionHash") ?? "");

    if (isPinataConfigured) {
      setBusy(true);
      try {
        setNotice("Publication du motif sur IPFS…");
        const cid = await uploadProposalMotive(
          selected.id,
          actionNames[action] ?? String(action),
          String(form.get("description")),
        );
        descriptionHash = `ipfs://${cid}`;
      } catch (error) {
        setNotice(`Publication IPFS impossible : ${error instanceof Error ? error.message : "erreur inconnue"}`);
        return;
      } finally {
        setBusy(false);
      }
    }

    const success = await sendTransaction("Création de la proposition", async (signer) =>
      new Contract(addresses.governance, governanceAbi, signer).createProposal(selected.id, action, descriptionHash),
    );
    if (success) element.reset();
  }

  return (
    <form className="proposal-form" onSubmit={submit}>
      <span className="form-index">01 / PROPOSER</span>
      <h3>Soumettre une décision</h3>
      <p>
        Le poids de chaque vote sera figé au bloc précédant la proposition. Un retrait exige une décision approuvée.
        Le motif est publié sur IPFS : la blockchain n’en conserve que l’empreinte.
      </p>
      <label>
        Campagne
        <select name="campaignId" value={campaignId} onChange={(event) => setCampaignId(event.target.value)} required disabled={campaigns.length === 0}>
          {campaigns.length === 0 && <option value="">Aucune campagne</option>}
          {campaigns.map((campaign) => (
            <option key={campaign.id} value={campaign.id}>
              #{campaign.id} · {campaignTitle(campaign, metadata)} · {campaignStates[campaign.status]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Action
        <select name="action" value={action} onChange={(event) => setAction(Number(event.target.value))}>
          {actionNames.map((name, index) => (
            <option key={name} value={index} disabled={blockers[index] !== null}>
              {name}{blockers[index] && selected ? ` — indisponible (${blockers[index]})` : ""}
            </option>
          ))}
        </select>
      </label>
      {selected && !actionAllowed && (
        <small className="field-hint">Aucune action possible sur cette campagne dans son état actuel.</small>
      )}
      {isPinataConfigured ? (
        <label>Motif<textarea name="description" rows={3} maxLength={1000} placeholder="Expliquez le motif vérifiable…" required /></label>
      ) : (
        <label>
          Hash IPFS du motif
          <input name="descriptionHash" placeholder="ipfs://bafy…" required />
          <small className="field-hint">
            Renseignez <code>VITE_PINATA_JWT</code> pour rédiger le motif directement ici.
          </small>
        </label>
      )}
      <button disabled={!account || !hasVotes || busy || !isConfigured || !actionAllowed}>Créer la proposition</button>
      {account && !hasVotes && (
        <small className="field-hint">
          Il faut détenir des CFD au bloc précédent pour proposer. Contribuez puis attendez un bloc.
        </small>
      )}
    </form>
  );
}
