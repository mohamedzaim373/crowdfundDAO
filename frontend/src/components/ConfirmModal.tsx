import { ReactNode, useCallback, useEffect, useRef, useState } from "react";

export type ConfirmRequest = {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  /** Action irréversible ou bloquante : bouton rouge. */
  danger?: boolean;
  onConfirm: () => void;
};

/**
 * Modale de confirmation basée sur `<dialog>` : le navigateur gère le piège de
 * focus, la touche Échap et l'arrière-plan inerte. Remplace `window.confirm`,
 * qui bloque le thread et ne peut pas être mis en forme.
 */
export function ConfirmModal({ request, onClose }: { request: ConfirmRequest | null; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (request && !dialog.open) dialog.showModal();
    if (!request && dialog.open) dialog.close();
  }, [request]);

  return (
    <dialog
      ref={dialogRef}
      className="confirm-modal"
      aria-labelledby="confirm-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        // Clic sur le fond (la cible est le <dialog> lui-même) = annulation.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {request && (
        <div className="confirm-body">
          <h3 id="confirm-title">{request.title}</h3>
          <div className="confirm-message">{request.message}</div>
          <div className="confirm-actions">
            <button type="button" className="confirm-cancel" onClick={onClose} autoFocus>
              Annuler
            </button>
            <button
              type="button"
              className={request.danger ? "confirm-danger" : "confirm-ok"}
              onClick={() => {
                onClose();
                request.onConfirm();
              }}
            >
              {request.confirmLabel}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}

export function useConfirm() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const close = useCallback(() => setRequest(null), []);
  return { confirm: setRequest, modal: <ConfirmModal request={request} onClose={close} /> };
}
