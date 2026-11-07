import { FormEvent, useState } from "react";
import { Contract, isAddress, isHexString, JsonRpcSigner, parseEther } from "ethers";
import { addresses, treasuryAbi } from "../contracts";
import { SendTransaction, TreasuryState, TreasuryTransaction } from "../lib/chain";
import { formatEth, sameAddress, shortAddress } from "../lib/format";

type Props = {
  account: string;
  treasury: TreasuryState | null;
  busy: boolean;
  sendTransaction: SendTransaction;
};

function parseAmount(value: string): bigint | null {
  try {
    const amount = parseEther(value.trim() || "0");
    return amount >= 0n ? amount : null;
  } catch {
    return null;
  }
}

/** Hex pair, « 0x » ou vide : tout le reste serait refusé par l'encodeur ABI. */
function normalizeData(value: string): string | null {
  const data = value.trim() || "0x";
  return isHexString(data) && data.length % 2 === 0 ? data : null;
}

/**
 * Trésorerie 2-sur-3 : lecture publique, actions réservées aux propriétaires.
 * Le nombre de signatures requis est relu on-chain (`requiredConfirmations`)
 * pour chaque transaction listée ; pendant la saisie, la même règle est
 * reproduite localement pour un retour immédiat.
 */
export default function TreasuryPanel({ account, treasury, busy, sendTransaction }: Props) {
  const [target, setTarget] = useState("");
  const [amount, setAmount] = useState("");
  const [data, setData] = useState("0x");
  const [deposit, setDeposit] = useState("");

  if (!treasury) {
    return (
      <section className="section treasury" id="treasury">
        <div className="section-heading"><div><p className="eyebrow">Multisig 2 sur 3</p><h2>Trésorerie</h2></div></div>
        <div className="empty">Lecture de la trésorerie en cours…</div>
      </section>
    );
  }

  const treasuryContract = (signer: JsonRpcSigner) =>
    new Contract(addresses.treasury, treasuryAbi, signer);

  const parsedAmount = parseAmount(amount);
  const parsedData = normalizeData(data);
  const validTarget = isAddress(target);
  // Même règle que MultiSigTreasury.requiredConfirmations(value, carriesData).
  const liveRequired =
    parsedData && parsedData.length > 2 ? 2 : parsedAmount !== null && parsedAmount > treasury.threshold ? 2 : 1;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validTarget || parsedAmount === null || parsedData === null) return;
    const ok = await sendTransaction("Soumission d’un retrait multisig", async (signer) =>
      treasuryContract(signer).submitTransaction(target, parsedAmount, parsedData),
    );
    if (ok) {
      setTarget("");
      setAmount("");
      setData("0x");
    }
  }

  async function sendDeposit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = parseAmount(deposit);
    if (!value) return;
    const ok = await sendTransaction("Dépôt dans la trésorerie", async (signer) =>
      signer.sendTransaction({ to: addresses.treasury, value }),
    );
    if (ok) setDeposit("");
  }

  function actions(transaction: TreasuryTransaction) {
    if (!treasury?.isOwner || transaction.executed) return null;
    const ready = transaction.confirmations >= transaction.required;
    const label = `transaction multisig #${transaction.id}`;
    return (
      <div className="tx-actions">
        {transaction.confirmedByMe ? (
          <button type="button" className="btn-ghost" disabled={busy}
            onClick={() => sendTransaction(`Révocation de la ${label}`, async (signer) => treasuryContract(signer).revokeConfirmation(transaction.id))}>
            Révoquer
          </button>
        ) : (
          <button type="button" className="btn-primary" disabled={busy}
            onClick={() => sendTransaction(`Confirmation de la ${label}`, async (signer) => treasuryContract(signer).confirmTransaction(transaction.id))}>
            Confirmer
          </button>
        )}
        <button type="button" className="btn-dark" disabled={busy || !ready}
          title={ready ? undefined : `${transaction.required - transaction.confirmations} confirmation(s) manquante(s)`}
          onClick={() => sendTransaction(`Exécution de la ${label}`, async (signer) => treasuryContract(signer).executeTransaction(transaction.id))}>
          Exécuter
        </button>
      </div>
    );
  }

  return (
    <section className="section treasury" id="treasury" aria-labelledby="treasury-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Multisig 2 sur 3</p>
          <h2 id="treasury-title">Trésorerie</h2>
        </div>
        <span className="network-chip">● {shortAddress(addresses.treasury)}</span>
      </div>

      <div className="treasury-summary">
        <article className="panel-card">
          <span className="panel-label">Solde</span>
          <strong className="panel-figure">{formatEth(treasury.balance, 4)} ETH</strong>
          <span className="field-hint">
            Au-delà de <b>{formatEth(treasury.threshold, 4)} ETH</b>, ou pour tout appel avec données, 2 signatures sont requises.
          </span>
        </article>
        <article className="panel-card">
          <span className="panel-label">Propriétaires</span>
          <ul className="owner-list">
            {treasury.owners.map((owner, index) => (
              <li key={owner}>
                <span className="owner-index">{index + 1}</span>
                <code title={owner}>{shortAddress(owner)}</code>
                {sameAddress(owner, account) && <span className="badge badge-ok">vous</span>}
              </li>
            ))}
          </ul>
        </article>
        <form className="panel-card" onSubmit={sendDeposit}>
          <span className="panel-label">Approvisionner</span>
          <div className="input-unit">
            <input type="number" min="0.0001" step="0.0001" value={deposit} onChange={(event) => setDeposit(event.target.value)} placeholder="2" aria-label="Montant du dépôt en ETH" required />
            <span>ETH</span>
          </div>
          <button className="btn-dark" disabled={!account || busy || !parseAmount(deposit)}>Déposer</button>
        </form>
      </div>

      <div className={`treasury-layout${treasury.isOwner ? "" : " treasury-layout--readonly"}`}>
        <div className="panel-card">
          <h3>Transactions</h3>
          {treasury.transactions.length === 0 ? (
            <p className="field-hint">Aucune transaction soumise.</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table tx-table">
                <thead>
                  <tr><th>#</th><th>Cible</th><th>Montant</th><th>Data</th><th>Signatures</th><th>Statut</th>{treasury.isOwner && <th><span className="sr-only">Actions</span></th>}</tr>
                </thead>
                <tbody>
                  {treasury.transactions.map((transaction) => (
                    <tr key={transaction.id}>
                      <td data-label="#">{transaction.id}</td>
                      <td data-label="Cible"><code title={transaction.target}>{shortAddress(transaction.target)}</code></td>
                      <td data-label="Montant">{formatEth(transaction.value, 4)} ETH</td>
                      <td data-label="Data">{transaction.data.length > 2 ? "oui" : "non"}</td>
                      <td data-label="Signatures">
                        <b>{transaction.confirmations} / {transaction.required}</b>
                        {transaction.confirmedByMe && <span className="badge badge-ok">signé</span>}
                      </td>
                      <td data-label="Statut">
                        <span className={`badge ${transaction.executed ? "badge-ok" : transaction.confirmations >= transaction.required ? "badge-info" : "badge-warn"}`}>
                          {transaction.executed ? "Exécutée" : transaction.confirmations >= transaction.required ? "Prête" : "En attente"}
                        </span>
                        {!transaction.executed && transaction.value > treasury.balance && (
                          <span className="field-error">Solde insuffisant</span>
                        )}
                      </td>
                      {treasury.isOwner && <td data-label="Actions">{actions(transaction)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {treasury.isOwner && (
          <form className="panel-card" onSubmit={submit}>
            <span className="form-index">PROPRIÉTAIRE / SOUMETTRE</span>
            <h3>Nouveau retrait</h3>
            <label>
              Cible
              <input value={target} onChange={(event) => setTarget(event.target.value.trim())} placeholder="0x…" spellCheck={false} required aria-invalid={target !== "" && !validTarget} />
            </label>
            {target !== "" && !validTarget && <p className="field-error">Adresse Ethereum invalide.</p>}
            <label>
              Montant
              <span className="input-unit">
                <input type="number" min="0" step="0.0001" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.5" required />
                <span>ETH</span>
              </span>
            </label>
            <label>
              Data (optionnelle)
              <input value={data} onChange={(event) => setData(event.target.value.trim())} placeholder="0x" spellCheck={false} aria-invalid={parsedData === null} />
            </label>
            {parsedData === null && <p className="field-error">Hexadécimal attendu (« 0x » pour un simple virement).</p>}
            <p className={`signature-hint ${liveRequired === 2 ? "signature-hint--two" : ""}`} aria-live="polite">
              {liveRequired === 2 ? "2 signatures requises" : "1 signature suffit"}
              <small>
                {parsedData && parsedData.length > 2
                  ? " — l’appel transporte des données."
                  : liveRequired === 2
                    ? ` — montant supérieur à ${formatEth(treasury.threshold, 4)} ETH.`
                    : ` — montant ≤ ${formatEth(treasury.threshold, 4)} ETH.`}
              </small>
            </p>
            <button className="btn-dark wide-btn" disabled={busy || !validTarget || parsedAmount === null || parsedData === null}>
              Soumettre (vaut 1re signature)
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
