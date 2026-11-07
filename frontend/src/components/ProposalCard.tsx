import { Contract } from "ethers";
import { addresses, governanceAbi } from "../contracts";
import { SendTransaction } from "../lib/chain";
import { formatEth, plural } from "../lib/format";
import { actionNames, Proposal, proposalStates } from "../types";

type Props = {
  proposal: Proposal;
  currentBlock: number;
  account: string;
  busy: boolean;
  alreadyVoted: boolean;
  motive?: string;
  motiveUrl: string | null;
  campaignLabel: string;
  sendTransaction: SendTransaction;
};

const PROPOSAL_DEFEATED = 1;

/** Raison lisible d'un rejet, reproduisant `_proposalPassed`. */
export function defeatReason(proposal: Proposal) {
  const total = proposal.votesFor + proposal.votesAgainst;
  if (total < proposal.quorum) return "Quorum non atteint";
  if (proposal.votesFor < proposal.majorityThreshold) return "Majorité absolue non atteinte";
  return "Conditions d’adoption non atteintes";
}

/**
 * Carte de proposition : en plus du vote, elle expose le calendrier en blocs,
 * le quorum figé au snapshot et le poids de vote de l'utilisateur, pour qu'un
 * votant comprenne pourquoi un bouton est grisé ou pourquoi une décision échoue.
 */
export default function ProposalCard({
  proposal,
  currentBlock,
  account,
  busy,
  alreadyVoted,
  motive,
  motiveUrl,
  campaignLabel,
  sendTransaction,
}: Props) {
  const total = proposal.votesFor + proposal.votesAgainst;
  const forPercent = total === 0n ? 0 : Number((proposal.votesFor * 100n) / total);
  const quorumPercent =
    proposal.quorum === 0n ? 100 : Math.min(100, Number((total * 10_000n) / proposal.quorum) / 100);
  const quorumReached = total >= proposal.quorum;
  const majorityPercent = Math.min(
    100,
    Number((proposal.votesFor * 10_000n) / proposal.majorityThreshold) / 100,
  );
  const majorityReached = proposal.votesFor >= proposal.majorityThreshold;

  // Le vote est accepté tant que block.number <= deadlineBlock ; l'exécution
  // dès que block.number >= executeAfterBlock.
  const blocksToDeadline = proposal.deadlineBlock - currentBlock;
  const blocksToExecution = proposal.executeAfterBlock - currentBlock;
  const votingOpen = proposal.state === 0;
  const noWeight = account !== "" && proposal.userWeight === 0n;

  const vote = (support: boolean) =>
    sendTransaction(support ? "Vote pour" : "Vote contre", async (signer) =>
      new Contract(addresses.governance, governanceAbi, signer).castVote(proposal.id, support),
    );

  return (
    <article className="proposal">
      <div>
        <span className="proposal-number">PROP. {proposal.id.toString().padStart(3, "0")}</span>
        <span className="proposal-state">{proposalStates[proposal.state]}</span>
      </div>
      {/* Le motif vient d'IPFS : tant qu'il n'est pas arrivé, on l'annonce
          plutôt que d'afficher un titre vide. */}
      <h3 className={motive ? undefined : "proposal-pending"}>
        {motive ?? "Motif en cours de chargement depuis IPFS…"}
      </h3>
      <p>
        {actionNames[proposal.action]} · {campaignLabel}
        {motiveUrl && (
          <>
            {" · "}
            <a className="proposal-source" href={motiveUrl} target="_blank" rel="noreferrer">
              Vérifier le motif ↗
            </a>
          </>
        )}
      </p>

      <dl className="proposal-blocks">
        <div><dt>Snapshot</dt><dd>bloc {proposal.snapshotBlock.toLocaleString("fr-FR")}</dd></div>
        <div><dt>Bloc courant</dt><dd>{currentBlock.toLocaleString("fr-FR")}</dd></div>
        <div>
          <dt>Fin du vote</dt>
          <dd>{blocksToDeadline >= 0 ? `dans ${plural(blocksToDeadline, "bloc")}` : "terminé"}</dd>
        </div>
        <div>
          <dt>Exécution</dt>
          <dd>
            {proposal.executed
              ? "faite"
              : blocksToExecution > 0
                ? `dans ${plural(blocksToExecution, "bloc")}`
                : "possible"}
          </dd>
        </div>
      </dl>

      <div className="vote-bar"><span style={{ width: `${forPercent}%` }} /></div>
      <div className="vote-totals">
        <span>Pour <b>{formatEth(proposal.votesFor)} CFD</b></span>
        <span>Contre <b>{formatEth(proposal.votesAgainst)} CFD</b></span>
      </div>

      <div className="quorum">
        <div className="quorum-label">
          <span>Quorum {quorumReached ? "atteint ✓" : "non atteint"}</span>
          <span><b>{formatEth(total)}</b> / {formatEth(proposal.quorum)} CFD exprimés</span>
        </div>
        <div className={`quorum-bar${quorumReached ? " quorum-bar--ok" : ""}`} role="progressbar"
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(quorumPercent)} aria-label="Progression vers le quorum">
          <span style={{ width: `${quorumPercent}%` }} />
        </div>
      </div>

      <div className="quorum">
        <div className="quorum-label">
          <span>Majorité absolue {majorityReached ? "atteinte ✓" : "non atteinte"}</span>
          <span><b>{formatEth(proposal.votesFor)}</b> / {formatEth(proposal.majorityThreshold)} CFD « Pour »</span>
        </div>
        <div className={`quorum-bar${majorityReached ? " quorum-bar--ok" : ""}`} role="progressbar"
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(majorityPercent)} aria-label="Progression vers la majorité absolue">
          <span style={{ width: `${majorityPercent}%` }} />
        </div>
      </div>

      {proposal.state === PROPOSAL_DEFEATED && <p className="defeat-reason">Rejetée : {defeatReason(proposal)}.</p>}

      {account && (
        <p className="weight-note">
          Votre poids pour cette proposition : <b>{formatEth(proposal.userWeight)} CFD</b>
          {noWeight && votingOpen && <> — aucun CFD détenu au bloc du snapshot.</>}
        </p>
      )}

      {votingOpen &&
        (alreadyVoted ? (
          <p className="voted-note">✓ Votre vote est enregistré sur cette proposition.</p>
        ) : (
          <div className="vote-actions">
            <button disabled={!account || busy || noWeight} onClick={() => vote(true)}>Voter pour</button>
            <button disabled={!account || busy || noWeight} onClick={() => vote(false)}>Voter contre</button>
          </div>
        ))}
      {proposal.state === 3 && (
        <button
          className="execute"
          disabled={!account || busy}
          onClick={() =>
            sendTransaction("Exécution de la proposition", async (signer) =>
              new Contract(addresses.governance, governanceAbi, signer).execute(proposal.id),
            )
          }
        >
          Exécuter
        </button>
      )}
    </article>
  );
}
