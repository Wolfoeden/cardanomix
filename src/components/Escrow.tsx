import { useState, type ReactNode } from "react";
import { formatAda, lovelaceToAdaString } from "../../shared/money";
import type { DepositPreview, PayoutPreview, Trade } from "../../shared/types";
import { api, ApiError, errorMessage } from "../api";
import { useConfig } from "../hooks";
import { activeWalletApi, walletErrorMessage } from "../wallet";
import { ExternalIcon, ShieldIcon } from "./Icons";
import { CopyButton, formatDateTime, Modal, shortAddress } from "./Ui";

export function explorerAddressUrl(network: string | undefined, address: string): string {
  return network === "preprod" ? `https://preprod.cardanoscan.io/address/${address}` : `https://cardanoscan.io/address/${address}`;
}

export function explorerTxUrl(network: string | undefined, hash: string): string {
  return network === "preprod" ? `https://preprod.cardanoscan.io/transaction/${hash}` : `https://cardanoscan.io/transaction/${hash}`;
}

/** Stand der Treuhand: Adresse, Betrag, Fortschritt der Hinterlegung. */
export function EscrowBox({ trade, showManual }: { trade: Trade; showManual: boolean }) {
  const config = useConfig();
  const escrow = trade.escrow!;
  const progress = Math.min(1, escrow.fundedLovelace / escrow.requiredLovelace);
  return (
    <div className="escrow-box">
      <div className="escrow-head">
        <ShieldIcon size={18} />
        <strong>Treuhand auf der Blockchain</strong>
        <a href={explorerAddressUrl(config?.network, escrow.address)} target="_blank" rel="noreferrer" className="link-external small">
          im Explorer <ExternalIcon size={13} />
        </a>
      </div>
      <div className="escrow-amounts">
        <div>
          <span className="muted small">Zu hinterlegen</span>
          <strong>{formatAda(escrow.requiredLovelace)}</strong>
          <span className="muted small">
            {formatAda(trade.lovelace)} + {formatAda(escrow.requiredLovelace - trade.lovelace)} Gebührenpuffer
          </span>
        </div>
        <div>
          <span className="muted small">Eingegangen</span>
          <strong>{formatAda(escrow.fundedLovelace)}</strong>
          <span className="progress" aria-hidden="true">
            <span style={{ width: `${progress * 100}%` }} />
          </span>
        </div>
      </div>
      {showManual && (
        <details className="manual">
          <summary>Ohne Wallet-Verbindung manuell senden</summary>
          <p className="muted small">
            Sende genau diesen Betrag aus einer beliebigen Cardano-Wallet an die Treuhand-Adresse. Die Bestätigung erscheint
            hier automatisch nach 1–2 Minuten.
          </p>
          <div className="address-line">
            <strong>{formatAda(escrow.requiredLovelace - escrow.fundedLovelace)}</strong>
            <CopyButton value={lovelaceToAdaString(escrow.requiredLovelace - escrow.fundedLovelace)} label="Betrag kopieren" />
          </div>
          <div className="address-line">
            <code className="address">{escrow.address}</code>
            <CopyButton value={escrow.address} label="Adresse kopieren" />
          </div>
        </details>
      )}
    </div>
  );
}

/** Zeigt, was signiert wird, bevor die Wallet gefragt wird. */
function SignStep({
  title,
  rows,
  note,
  confirmLabel,
  tone,
  busy,
  error,
  onConfirm,
  onClose,
}: {
  title: string;
  rows: { label: string; value: ReactNode }[];
  note?: ReactNode;
  confirmLabel: string;
  tone: "primary" | "buy";
  busy: string | null;
  error: string | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose}>
      <div className="stack">
        <dl className="summary">
          {rows.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
        {note && <p className="muted small">{note}</p>}
        {busy && (
          <p className="muted" role="status">
            <span className="spinner inline-spinner" aria-hidden="true" /> {busy}
          </p>
        )}
        {error && (
          <div className="notice notice-error" role="alert">
            {error}
          </div>
        )}
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy !== null}>
            Abbrechen
          </button>
          <button type="button" className={`btn btn-${tone}`} onClick={onConfirm} disabled={busy !== null}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Verkäufer: ADA per Wallet in die Treuhand legen. */
export function DepositButton({ trade, onDone }: { trade: Trade; onDone: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<DepositPreview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setOpen(true);
    setPreview(null);
    setError(null);
    setBusy("Wallet wird abgefragt …");
    try {
      const wallet = await activeWalletApi();
      const [utxos, changeAddress] = await Promise.all([wallet.getUtxos(), wallet.getChangeAddress()]);
      if (!utxos || utxos.length === 0) throw new Error("In der verbundenen Wallet wurden keine ADA gefunden.");
      setBusy("Transaktion wird vorbereitet …");
      setPreview(await api.depositTx(trade.id, utxos, changeAddress));
      setBusy(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : walletErrorMessage(err, errorMessage(err)));
      setBusy(null);
    }
  }

  async function confirm() {
    if (!preview) return;
    setError(null);
    try {
      setBusy("Bitte in der Wallet bestätigen …");
      const wallet = await activeWalletApi();
      let witnessSet: string;
      try {
        witnessSet = await wallet.signTx(preview.txHex, false);
      } catch (err) {
        throw new Error(walletErrorMessage(err, "Signatur fehlgeschlagen."));
      }
      setBusy("Wird eingereicht …");
      await api.submitDeposit(trade.id, preview.txHex, witnessSet);
      await api.checkEscrow(trade.id).catch(() => undefined);
      await onDone();
      setOpen(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <button type="button" className="btn btn-primary btn-lg" onClick={() => void start()}>
        <ShieldIcon size={18} /> Mit Wallet in Treuhand legen
      </button>
      {open && (
        <SignStep
          title="ADA in die Treuhand legen"
          rows={
            preview
              ? [
                  { label: "An die Treuhand", value: <strong>{formatAda(preview.lovelace)}</strong> },
                  { label: "Treuhand-Adresse", value: <code className="address">{shortAddress(preview.escrowAddress)}</code> },
                  { label: "Netzwerkgebühr", value: formatAda(preview.fee) },
                ]
              : []
          }
          note="Die ADA verlassen deine Wallet und liegen dann auf der Treuhand-Adresse. Freigeben kannst nur du (oder die Moderation im Streitfall); CardanoMix allein kann sie nicht bewegen."
          confirmLabel="In der Wallet bestätigen"
          tone="primary"
          busy={busy}
          error={error}
          onConfirm={() => void confirm()}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

const PAYOUT_TEXT = {
  release: {
    button: "Zahlung erhalten – ADA freigeben",
    title: "ADA an den Käufer freigeben",
    note: "Gib die ADA nur frei, wenn das Geld wirklich auf deinem Konto gutgeschrieben ist. Die Freigabe ist endgültig.",
    tone: "buy" as const,
  },
  claim: {
    button: "ADA abholen",
    title: "ADA aus der Treuhand abholen",
    note: "Die Moderation hat zu deinen Gunsten entschieden. Mit deiner Signatur und der von CardanoMix gehen die ADA an deine Adresse.",
    tone: "buy" as const,
  },
  refund: {
    button: "ADA zurückholen",
    title: "ADA aus der Treuhand zurückholen",
    note: "Der Handel ist abgebrochen. Die ADA gehen zurück an deine Adresse.",
    tone: "primary" as const,
  },
};

/** Auszahlung aus der Treuhand: Freigabe (Verkäufer), Abholen (Käufer nach Entscheidung) oder Rückholen (Verkäufer). */
export function PayoutButton({
  trade,
  variant,
  onDone,
}: {
  trade: Trade;
  variant: "release" | "claim" | "refund";
  onDone: () => Promise<void>;
}) {
  const text = PAYOUT_TEXT[variant];
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<PayoutPreview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setOpen(true);
    setPreview(null);
    setError(null);
    setBusy("Transaktion wird vorbereitet …");
    try {
      setPreview(await api.payoutTx(trade.id, variant === "refund" ? "refund" : "release"));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function confirm() {
    if (!preview) return;
    setError(null);
    try {
      setBusy("Bitte in der Wallet bestätigen …");
      const wallet = await activeWalletApi();
      let witnessSet: string;
      try {
        witnessSet = await wallet.signTx(preview.txHex, true);
      } catch (err) {
        throw new Error(walletErrorMessage(err, "Signatur fehlgeschlagen."));
      }
      setBusy("CardanoMix signiert mit und reicht ein …");
      await api.submitPayout(trade.id, witnessSet);
      await api.checkEscrow(trade.id).catch(() => undefined);
      await onDone();
      setOpen(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const rows = preview
    ? [
        ...(preview.toAddress
          ? [
              { label: "An den Käufer", value: <strong>{formatAda(preview.toLovelace)}</strong> },
              { label: "Käuferadresse", value: <code className="address">{shortAddress(preview.toAddress)}</code> },
            ]
          : []),
        { label: preview.toAddress ? "Rest an den Verkäufer" : "Zurück an dich", value: formatAda(preview.changeLovelace) },
        { label: "Netzwerkgebühr", value: formatAda(preview.fee) },
      ]
    : [];

  return (
    <>
      <button type="button" className={`btn btn-${text.tone} btn-lg`} onClick={() => void start()}>
        {text.button}
      </button>
      {open && (
        <SignStep
          title={text.title}
          rows={rows}
          note={text.note}
          confirmLabel="In der Wallet bestätigen"
          tone={text.tone}
          busy={busy}
          error={error}
          onConfirm={() => void confirm()}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export function CheckEscrowButton({ trade, onDone }: { trade: Trade; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className="btn btn-ghost"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await api.checkEscrow(trade.id);
            await onDone();
          } catch (err) {
            setError(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Prüfe …" : "Treuhand jetzt prüfen"}
      </button>
      {error && <span className="field-error">{error}</span>}
    </>
  );
}

/** Transparenz: Adresse, Script und Notausgang. */
export function EscrowDetails({ trade }: { trade: Trade }) {
  const config = useConfig();
  const escrow = trade.escrow!;
  return (
    <div className="terms">
      <h3>
        <ShieldIcon size={16} /> Treuhand
      </h3>
      <dl className="facts facts-compact">
        <div>
          <dt>Adresse</dt>
          <dd className="address-line">
            <a href={explorerAddressUrl(config?.network, escrow.address)} target="_blank" rel="noreferrer">
              <code className="address">{escrow.address}</code>
            </a>
          </dd>
        </div>
        {escrow.depositTxHash && (
          <div>
            <dt>Hinterlegung</dt>
            <dd>
              <a href={explorerTxUrl(config?.network, escrow.depositTxHash)} target="_blank" rel="noreferrer">
                <code className="address">{escrow.depositTxHash}</code>
              </a>
            </dd>
          </div>
        )}
        {escrow.payoutTxHash && (
          <div>
            <dt>{escrow.payoutKind === "refund" ? "Rückzahlung" : "Auszahlung"}</dt>
            <dd>
              <a href={explorerTxUrl(config?.network, escrow.payoutTxHash)} target="_blank" rel="noreferrer">
                <code className="address">{escrow.payoutTxHash}</code>
              </a>
            </dd>
          </div>
        )}
        <div>
          <dt>Regeln</dt>
          <dd>
            Auszahlung nur mit 2 von 3 Unterschriften (Verkäufer, Käufer, CardanoMix). Ab {formatDateTime(escrow.refundAfter)} kann der
            Verkäufer die ADA auch allein, ohne CardanoMix, zurückholen.
          </dd>
        </div>
        <div>
          <dt>Native Script</dt>
          <dd className="address-line">
            <CopyButton value={escrow.script} label="Script (CBOR) kopieren" />
          </dd>
        </div>
      </dl>
    </div>
  );
}
