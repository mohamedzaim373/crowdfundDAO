import { FormEvent, useState } from "react";
import { Contract, formatEther, isAddress, parseEther } from "ethers";
import { addresses, tokenAbi } from "../contracts";
import { SendTransaction, TokenState } from "../lib/chain";
import { formatEth } from "../lib/format";

type Props = {
  token: TokenState;
  tokenPaused: boolean;
  busy: boolean;
  sendTransaction: SendTransaction;
};

function parsePositive(value: string): bigint | null {
  try {
    const amount = parseEther(value.trim());
    return amount > 0n ? amount : null;
  } catch {
    return null;
  }
}

/**
 * « Mes CFD » : distingue le solde, la part verrouillée tant que la
 * contribution reste remboursable, et les voix. Le cahier des charges
 * impose un vote pondéré par le solde : le contrat auto-délègue à la
 * réception, donc les voix suivent le solde sans action du détenteur.
 */
export default function TokenPanel({ token, tokenPaused, busy, sendTransaction }: Props) {
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [forceSend, setForceSend] = useState(false);

  const free = token.balance > token.locked ? token.balance - token.locked : 0n;

  const parsedAmount = parsePositive(amount);
  const validRecipient = isAddress(recipient);
  const exceedsFree = parsedAmount !== null && parsedAmount > free;

  async function transfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validRecipient || parsedAmount === null) return;
    const ok = await sendTransaction("Transfert de CFD", async (signer) =>
      new Contract(addresses.token, tokenAbi, signer).transfer(recipient, parsedAmount),
    );
    if (ok) {
      setAmount("");
      setForceSend(false);
    }
  }

  return (
    <section className="section cfd" id="my-cfd" aria-labelledby="cfd-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Jetons de gouvernance</p>
          <h2 id="cfd-title">Mes CFD</h2>
        </div>
      </div>

      <div className="cfd-stats">
        <article><span>Solde total</span><strong>{formatEth(token.balance, 2)} CFD</strong></article>
        <article><span>Verrouillé</span><strong>{formatEth(token.locked, 2)} CFD</strong><small>tant que la contribution est remboursable</small></article>
        <article><span>Libre</span><strong>{formatEth(free, 2)} CFD</strong><small>transférable</small></article>
        <article>
          <span>Voix</span>
          <strong>{formatEth(token.votes, 2)}</strong>
          <small>égales au solde : le vote est pondéré par la détention</small>
        </article>
      </div>

      <div className="cfd-forms">
        <form className="panel-card" onSubmit={transfer}>
          <span className="form-index">TRANSFERT</span>
          <h3>Envoyer des CFD</h3>
          <p className="panel-lede">Seul le solde libre ({formatEth(free, 2)} CFD) peut quitter votre compte.</p>
          <label>
            Destinataire
            <input value={recipient} onChange={(event) => setRecipient(event.target.value.trim())} placeholder="0x…" spellCheck={false} required aria-invalid={recipient !== "" && !validRecipient} />
          </label>
          {recipient !== "" && !validRecipient && <p className="field-error">Adresse Ethereum invalide.</p>}
          <label>
            Montant
            <span className="input-unit">
              <input type="number" min="0" step="any" value={amount} onChange={(event) => { setAmount(event.target.value); setForceSend(false); }} placeholder="10" required />
              <span>CFD</span>
            </span>
          </label>
          <button type="button" className="link-button" onClick={() => setAmount(free > 0n ? formatEther(free) : "")} disabled={free === 0n}>
            Utiliser le solde libre
          </button>
          {exceedsFree && (
            <div className="inline-alert">
              Montant supérieur au solde libre : le contrat refusera le transfert (CFD verrouillés).
              <label className="check-row">
                <input type="checkbox" checked={forceSend} onChange={(event) => setForceSend(event.target.checked)} />
                Envoyer quand même pour constater le refus on-chain
              </label>
            </div>
          )}
          {tokenPaused && <p className="field-error">CFDToken en pause : les transferts sont suspendus.</p>}
          <button className="btn-dark wide-btn" disabled={busy || tokenPaused || !validRecipient || parsedAmount === null || (exceedsFree && !forceSend)}>
            Transférer
          </button>
        </form>
      </div>
    </section>
  );
}

