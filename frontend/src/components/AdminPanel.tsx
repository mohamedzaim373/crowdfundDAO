import { FormEvent, useEffect, useMemo, useState } from "react";
import { Contract, isAddress, JsonRpcSigner } from "ethers";
import { addresses, coreAbi, tokenAbi } from "../contracts";
import {
  AdminState,
  CONTRACT_ROLES,
  coreReader,
  ROLES,
  RoleName,
  SendTransaction,
  tokenReader,
} from "../lib/chain";
import { campaignTitle, sameAddress, shortAddress } from "../lib/format";
import { Campaign, CampaignMetadata, CampaignState } from "../types";
import { useConfirm } from "./ConfirmModal";

type Props = {
  account: string;
  admin: AdminState;
  campaigns: Campaign[];
  metadata: Record<string, CampaignMetadata>;
  busy: boolean;
  sendTransaction: SendTransaction;
};

type Target = "core" | "token";

const TARGET_LABELS: Record<Target, string> = { core: "CrowdfundingCore", token: "CFDToken" };

/**
 * Panneau réservé aux comptes ayant DEFAULT_ADMIN_ROLE ou PAUSER_ROLE.
 * Les droits affichés ne sont qu'un confort : le contrat reste l'autorité et
 * toute erreur on-chain remonte telle quelle dans la notice.
 */
export default function AdminPanel({ account, admin, campaigns, metadata, busy, sendTransaction }: Props) {
  const { confirm, modal } = useConfirm();

  const contractFor = (target: Target) => (signer: JsonRpcSigner) =>
    new Contract(target === "core" ? addresses.core : addresses.token, target === "core" ? coreAbi : tokenAbi, signer);

  // --- Circuit breaker -------------------------------------------------------
  function togglePause(target: Target, paused: boolean) {
    const name = TARGET_LABELS[target];
    if (paused) {
      void sendTransaction(`Reprise de ${name}`, async (signer) => contractFor(target)(signer).unpause());
      return;
    }
    confirm({
      title: `Mettre ${name} en pause ?`,
      message:
        target === "core" ? (
          <p>Contributions, retraits, remboursements et créations de campagne seront refusés pour tous les utilisateurs jusqu’à la reprise.</p>
        ) : (
          <p>Les transferts et la création de CFD seront bloqués : les contributions échoueront aussi, car elles émettent des CFD. Les remboursements restent possibles.</p>
        ),
      confirmLabel: "Mettre en pause",
      danger: true,
      onConfirm: () => void sendTransaction(`Pause de ${name}`, async (signer) => contractFor(target)(signer).pause()),
    });
  }

  // --- Annulation de campagne ------------------------------------------------
  // Le contrat n'accepte l'annulation que si le statut STOCKÉ est Active, même
  // si l'échéance est passée (statut calculé Réussie/Échouée).
  const cancellable = useMemo(
    () => campaigns.filter((campaign) => campaign.storedState === CampaignState.Active),
    [campaigns],
  );
  const [cancelId, setCancelId] = useState<string>("");
  useEffect(() => {
    if (!cancellable.some((campaign) => String(campaign.id) === cancelId)) {
      setCancelId(cancellable[0] ? String(cancellable[0].id) : "");
    }
  }, [cancellable, cancelId]);

  function cancelCampaign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const campaign = cancellable.find((entry) => String(entry.id) === cancelId);
    if (!campaign) return;
    confirm({
      title: `Annuler la campagne #${campaign.id} ?`,
      message: (
        <p>
          « {campaignTitle(campaign, metadata)} » passera définitivement à l’état <b>Annulée</b>. Les contributeurs
          pourront réclamer leur remboursement ; leurs CFD associés seront brûlés.
        </p>
      ),
      confirmLabel: "Annuler la campagne",
      danger: true,
      onConfirm: () =>
        void sendTransaction(`Annulation de la campagne #${campaign.id}`, async (signer) =>
          contractFor("core")(signer).cancelCampaign(campaign.id),
        ),
    });
  }

  // --- Rôles -----------------------------------------------------------------
  const [roleTarget, setRoleTarget] = useState<Target>("core");
  const [role, setRole] = useState<RoleName>("PAUSER_ROLE");
  const [grantee, setGrantee] = useState("");
  const [granteeHasRole, setGranteeHasRole] = useState<boolean | null>(null);
  const validGrantee = isAddress(grantee);
  const canManageRoles = roleTarget === "core" ? admin.coreAdmin : admin.tokenAdmin;

  useEffect(() => {
    if (!CONTRACT_ROLES[roleTarget].includes(role)) setRole(CONTRACT_ROLES[roleTarget][0]);
  }, [roleTarget, role]);

  // Lecture indicative de l'état actuel du rôle pour l'adresse saisie ; relancée
  // à chaque rafraîchissement (`admin` change d'identité toutes les 4 s).
  useEffect(() => {
    if (!validGrantee) {
      setGranteeHasRole(null);
      return;
    }
    let cancelled = false;
    const reader = roleTarget === "core" ? coreReader() : tokenReader();
    (reader.hasRole(ROLES[role], grantee) as Promise<boolean>)
      .then((value) => !cancelled && setGranteeHasRole(value))
      .catch(() => !cancelled && setGranteeHasRole(null));
    return () => {
      cancelled = true;
    };
  }, [validGrantee, grantee, role, roleTarget, admin]);

  function submitRole(grant: boolean) {
    if (!validGrantee) return;
    const verb = grant ? "Accorder" : "Révoquer";
    const selfRevoke = !grant && sameAddress(grantee, account) && role === "DEFAULT_ADMIN_ROLE";
    confirm({
      title: `${verb} ${role} ?`,
      message: (
        <>
          <p>
            {verb} <code>{role}</code> sur <b>{TARGET_LABELS[roleTarget]}</b> {grant ? "à" : "pour"}{" "}
            <code>{shortAddress(grantee)}</code>.
          </p>
          {selfRevoke && <p className="confirm-warning">Vous retirez votre propre rôle d’administrateur : cette action peut être définitive.</p>}
          {grant && (role === "GOVERNANCE_ROLE" || role === "MINTER_ROLE") && (
            <p className="confirm-warning">Ce rôle permet de contourner la DAO s’il est confié à un compte personnel.</p>
          )}
        </>
      ),
      confirmLabel: verb,
      danger: !grant || role === "GOVERNANCE_ROLE" || role === "MINTER_ROLE" || role === "DEFAULT_ADMIN_ROLE",
      onConfirm: () =>
        void sendTransaction(`${verb} ${role}`, async (signer) => {
          const contract = contractFor(roleTarget)(signer);
          return grant ? contract.grantRole(ROLES[role], grantee) : contract.revokeRole(ROLES[role], grantee);
        }),
    });
  }

  const roleRows: { label: string; ok: boolean; expected: boolean }[] = [
    { label: "Core a MINTER_ROLE sur le Token", ok: admin.coreIsMinter, expected: true },
    { label: "Core a BURNER_ROLE sur le Token", ok: admin.coreIsBurner, expected: true },
    { label: "Governance a GOVERNANCE_ROLE sur le Core", ok: admin.governanceHasRole, expected: true },
    { label: "Vous avez DEFAULT_ADMIN_ROLE sur le Core", ok: admin.coreAdmin, expected: false },
    { label: "Vous avez PAUSER_ROLE sur le Core", ok: admin.corePauser, expected: false },
    { label: "Vous avez DEFAULT_ADMIN_ROLE sur le Token", ok: admin.tokenAdmin, expected: false },
    { label: "Vous avez PAUSER_ROLE sur le Token", ok: admin.tokenPauser, expected: false },
  ];

  const breakers: { target: Target; paused: boolean; canPause: boolean }[] = [
    { target: "core", paused: admin.corePaused, canPause: admin.corePauser },
    { target: "token", paused: admin.tokenPaused, canPause: admin.tokenPauser },
  ];

  return (
    <section className="admin" id="admin" aria-labelledby="admin-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Réservé aux rôles d’administration</p>
          <h2 id="admin-title">Administration</h2>
        </div>
        <span className="network-chip">● {shortAddress(account)}</span>
      </div>

      <div className="admin-grid">
        <article className="panel-card">
          <span className="form-index">01 / CIRCUIT BREAKER</span>
          <h3>Pause d’urgence</h3>
          <p className="panel-lede">Suspend les fonctions marquées <code>whenNotPaused</code> en cas d’incident.</p>
          <ul className="breaker-list">
            {breakers.map(({ target, paused, canPause }) => (
              <li key={target}>
                <div>
                  <b>{TARGET_LABELS[target]}</b>
                  <span className={`badge ${paused ? "badge-warn" : "badge-ok"}`}>{paused ? "En pause" : "Actif"}</span>
                </div>
                <button
                  type="button"
                  className={paused ? "btn-primary" : "btn-danger"}
                  disabled={busy || !canPause}
                  title={canPause ? undefined : "PAUSER_ROLE requis sur ce contrat"}
                  onClick={() => togglePause(target, paused)}
                >
                  {paused ? "Reprendre" : "Mettre en pause"}
                </button>
              </li>
            ))}
          </ul>
          {!admin.corePauser && !admin.tokenPauser && <p className="field-hint">PAUSER_ROLE requis pour agir.</p>}
        </article>

        <form className="panel-card" onSubmit={cancelCampaign}>
          <span className="form-index">02 / ANNULATION</span>
          <h3>Annuler une campagne</h3>
          <p className="panel-lede">Ouvre le remboursement pour tous les contributeurs. Irréversible.</p>
          <label>
            Campagne (statut stocké « En cours »)
            <select value={cancelId} onChange={(event) => setCancelId(event.target.value)} disabled={cancellable.length === 0}>
              {cancellable.length === 0 && <option value="">Aucune campagne annulable</option>}
              {cancellable.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  #{campaign.id} · {campaignTitle(campaign, metadata)}
                </option>
              ))}
            </select>
          </label>
          <button className="btn-danger wide-btn" disabled={busy || !admin.coreAdmin || !cancelId}>
            Annuler la campagne
          </button>
          {!admin.coreAdmin && <p className="field-hint">DEFAULT_ADMIN_ROLE sur le Core requis.</p>}
        </form>

        <article className="panel-card admin-roles">
          <span className="form-index">03 / RÔLES</span>
          <h3>Vérification des rôles</h3>
          <div className="table-wrap">
            <table className="data-table">
              <tbody>
                {roleRows.map((row) => (
                  <tr key={row.label}>
                    <td>{row.label}</td>
                    <td className={row.ok ? "check-ok" : row.expected ? "check-bad" : "check-off"} aria-label={row.ok ? "oui" : "non"}>
                      {row.ok ? "✓" : "✗"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(!admin.coreIsMinter || !admin.coreIsBurner || !admin.governanceHasRole) && (
            <p className="inline-alert">Câblage incomplet : redéployez ou accordez les rôles manquants aux contrats.</p>
          )}
        </article>

        <form className="panel-card" onSubmit={(event) => event.preventDefault()}>
          <span className="form-index">04 / GESTION</span>
          <h3>Accorder ou révoquer un rôle</h3>
          <p className="inline-alert">
            Accorder GOVERNANCE_ROLE ou MINTER_ROLE à un compte personnel contourne la DAO.
          </p>
          <div className="form-row">
            <label>
              Contrat
              <select value={roleTarget} onChange={(event) => setRoleTarget(event.target.value as Target)}>
                <option value="core">{TARGET_LABELS.core}</option>
                <option value="token">{TARGET_LABELS.token}</option>
              </select>
            </label>
            <label>
              Rôle
              <select value={role} onChange={(event) => setRole(event.target.value as RoleName)}>
                {CONTRACT_ROLES[roleTarget].map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </label>
          </div>
          <label>
            Adresse
            <input
              value={grantee}
              onChange={(event) => setGrantee(event.target.value.trim())}
              placeholder="0x…"
              spellCheck={false}
              aria-invalid={grantee !== "" && !validGrantee}
            />
          </label>
          {grantee !== "" && !validGrantee && <p className="field-error">Adresse Ethereum invalide.</p>}
          {validGrantee && granteeHasRole !== null && (
            <p className="field-hint">
              État actuel : cette adresse {granteeHasRole ? "possède" : "ne possède pas"} {role}.
            </p>
          )}
          <div className="form-row">
            <button type="button" className="btn-primary" disabled={busy || !canManageRoles || !validGrantee || granteeHasRole === true} onClick={() => submitRole(true)}>
              Accorder
            </button>
            <button type="button" className="btn-danger" disabled={busy || !canManageRoles || !validGrantee || granteeHasRole === false} onClick={() => submitRole(false)}>
              Révoquer
            </button>
          </div>
          {!canManageRoles && <p className="field-hint">DEFAULT_ADMIN_ROLE sur {TARGET_LABELS[roleTarget]} requis.</p>}
        </form>
      </div>
      {modal}
    </section>
  );
}
