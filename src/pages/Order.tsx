import { useState } from "react";
import { Link, useParams } from "react-router";
import { ORDER_LABELS, type PaymentPreview } from "../../shared/marketplace";
import { formatAda } from "../../shared/money";
import { errorMessage } from "../api";
import { useAuth } from "../auth";
import {
  CopyButton,
  ErrorNotice,
  Spinner,
  Modal,
  formatRemaining,
} from "../components/Ui";
import {
  useLoad,
  useInterval,
  useDocumentTitle,
  useNow,
  useConfig,
} from "../hooks";
import { marketApi } from "../marketplace-api";
import { activeWalletApi, walletErrorMessage } from "../wallet";
import { ConversationChat } from "./Messages";
export function OrderPage() {
  const { id } = useParams(),
    { me, ready, requireLogin } = useAuth(),
    config = useConfig();
  useDocumentTitle("Bestellung");
  const { data, error, loading, reload } = useLoad(
    () => (me ? marketApi.order(id!) : Promise.resolve(null)),
    [id, me?.id],
  );
  const [busy, setBusy] = useState(false),
    [actionError, setActionError] = useState<string | null>(null),
    [preview, setPreview] = useState<PaymentPreview | null>(null),
    [note, setNote] = useState("");
  const now = useNow();
  useInterval(() => {
    if (me) void reload();
  }, 10000);
  async function action(fn: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      await reload();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  if (!ready || (loading && !data)) return <Spinner />;
  if (!me)
    return (
      <div className="container section">
        <h1>Bestellung</h1>
        <button
          className="btn btn-primary"
          onClick={() => void requireLogin().catch(() => undefined)}
        >
          Mit Wallet anmelden
        </button>
      </div>
    );
  if (error)
    return (
      <div className="container section">
        <ErrorNotice error={error} />
      </div>
    );
  if (!data) return null;
  const o = data.order,
    buyer = me.id === o.buyerId,
    remaining = new Date(o.deadline).getTime() - now;
  return (
    <div className="container section">
      <Link to="/konto?tab=bestellungen">← Meine Bestellungen</Link>
      <h1>{o.title}</h1>
      <span className="status">{ORDER_LABELS[o.status]}</span>
      <div className="listing-detail-grid">
        <div className="stack">
          <section className="card stack">
            <h2>
              {o.status === "awaiting_payment"
                ? "Zahlung prüfen und signieren"
                : ORDER_LABELS[o.status]}
            </h2>
            <dl className="facts">
              <div>
                <dt>Kaufpreis</dt>
                <dd>{formatAda(o.priceLovelace)}</dd>
              </div>
              <div>
                <dt>Versand</dt>
                <dd>{formatAda(o.shippingLovelace)}</dd>
              </div>
              <div>
                <dt>Plattformgebühr</dt>
                <dd>{formatAda(o.feeLovelace)}</dd>
              </div>
              <div>
                <dt>Gesamt ohne Netzwerkgebühr</dt>
                <dd>
                  <strong>
                    {formatAda(
                      o.priceLovelace + o.shippingLovelace + o.feeLovelace,
                    )}
                  </strong>
                </dd>
              </div>
              <div>
                <dt>Verkäufer</dt>
                <dd>{o.sellerName}</dd>
              </div>
              <div>
                <dt>Käufer</dt>
                <dd>{o.buyerName}</dd>
              </div>
            </dl>
            {o.status === "awaiting_payment" && (
              <>
                <p>Reserviert für {formatRemaining(remaining)}.</p>
                {buyer && (
                  <button
                    className="btn btn-primary"
                    disabled={busy || remaining <= 0}
                    onClick={() =>
                      void action(async () => {
                        const wallet = await activeWalletApi();
                        if ((await wallet.getNetworkId()) !== config?.networkId)
                          throw new Error(
                            "Bitte die Wallet auf das richtige Netzwerk umstellen.",
                          );
                        const utxos = await wallet.getUtxos();
                        if (!utxos?.length)
                          throw new Error(
                            "Keine verfügbaren Wallet-UTxOs gefunden.",
                          );
                        setPreview(
                          await marketApi.paymentTx(
                            o.id,
                            utxos,
                            await wallet.getChangeAddress(),
                          ),
                        );
                      })
                    }
                  >
                    Zahlung vorbereiten
                  </button>
                )}
                <button
                  className="btn btn-ghost"
                  disabled={busy}
                  onClick={() =>
                    void action(() => marketApi.action(o.id, "cancel"))
                  }
                >
                  Bestellung abbrechen
                </button>
              </>
            )}
            {o.status === "payment_pending" && (
              <p role="status">
                Die Zahlung wird geprüft. {o.confirmations} von 10
                Bestätigungen. Das Angebot bleibt reserviert.
              </p>
            )}
            {o.txHash && (
              <div>
                <span className="small">Transaktionshash</span>
                <code className="address">{o.txHash}</code>
                <CopyButton value={o.txHash} />
              </div>
            )}
            {["payment_pending", "paid", "fulfilled"].includes(o.status) && (
              <button
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => void action(() => marketApi.check(o.id))}
              >
                Blockchain-Status prüfen
              </button>
            )}
            {["paid", "fulfilled"].includes(o.status) && (
              <>
                <label className="field">
                  <span>
                    {buyer
                      ? "Grund bei einem Streitfall"
                      : "Versand- oder Leistungsnachweis / Grund bei Streitfall"}
                  </span>
                  <textarea
                    rows={3}
                    maxLength={2000}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </label>
                {!buyer && o.status === "paid" && (
                  <button
                    disabled={busy || note.length < 3}
                    className="btn btn-primary"
                    onClick={() =>
                      void action(() => marketApi.action(o.id, "fulfill", note))
                    }
                  >
                    Als versandt / erbracht markieren
                  </button>
                )}
                {buyer && (
                  <button
                    disabled={busy}
                    className="btn btn-primary"
                    onClick={() =>
                      void action(() => marketApi.action(o.id, "complete"))
                    }
                  >
                    Erhalt bestätigen & abschließen
                  </button>
                )}
                <button
                  disabled={busy || note.length < 5}
                  className="btn btn-ghost"
                  onClick={() =>
                    void action(() => marketApi.action(o.id, "dispute", note))
                  }
                >
                  Streitfall eröffnen
                </button>
              </>
            )}
            {o.fulfillmentNote && (
              <p className="preserve-lines">{o.fulfillmentNote}</p>
            )}
            {o.disputeReason && (
              <div className="notice notice-warn">{o.disputeReason}</div>
            )}
            <p className="small muted">
              „Bezahlt“ bestätigt die ADA-Zahlung. „Abgeschlossen“ bestätigt den
              Erhalt. Eine Rückzahlung muss der Verkäufer separat signieren; die
              Plattformgebühr wird nicht automatisch erstattet.
            </p>
            {actionError && <ErrorNotice error={new Error(actionError)} />}
          </section>
          <section className="card">
            <h2>Vereinbartes Angebot</h2>
            <p className="preserve-lines">{o.description}</p>
            <p className="preserve-lines">{o.terms}</p>
            {o.deliveryDetails && (
              <>
                <h3>Private Lieferdaten</h3>
                <p className="preserve-lines">{o.deliveryDetails}</p>
              </>
            )}
          </section>
        </div>
        <ConversationChat id={o.conversationId} />
      </div>
      {preview && (
        <Modal
          title="ADA-Zahlung bestätigen"
          onClose={() => {
            if (!busy) setPreview(null);
          }}
        >
          <p>Prüfe Empfänger und Beträge auch in deiner Wallet.</p>
          <dl className="facts">
            <div>
              <dt>An den Verkäufer</dt>
              <dd>
                {formatAda(preview.sellerLovelace)}
                <code className="address">{preview.sellerAddress}</code>
              </dd>
            </div>
            <div>
              <dt>Plattformgebühr</dt>
              <dd>
                {formatAda(preview.feeLovelace)}
                <code className="address">{preview.feeAddress}</code>
              </dd>
            </div>
            <div>
              <dt>Netzwerkgebühr</dt>
              <dd>{formatAda(preview.networkFeeLovelace)}</dd>
            </div>
            <div>
              <dt>Gesamt</dt>
              <dd>
                {formatAda(
                  preview.sellerLovelace +
                    preview.feeLovelace +
                    preview.networkFeeLovelace,
                )}
              </dd>
            </div>
          </dl>
          {actionError && <ErrorNotice error={new Error(actionError)} />}
          <button
            className="btn btn-primary"
            disabled={busy || remaining <= 0}
            onClick={() =>
              void action(async () => {
                const wallet = await activeWalletApi();
                if ((await wallet.getNetworkId()) !== config?.networkId)
                  throw new Error("Wallet-Netzwerk stimmt nicht überein.");
                let signed: string;
                try {
                  signed = await wallet.signTx(preview.txHex, true);
                } catch (err) {
                  throw new Error(
                    walletErrorMessage(
                      err,
                      "Zahlung konnte nicht signiert werden.",
                    ),
                  );
                }
                await marketApi.pay(o.id, preview.txHash, signed);
                setPreview(null);
              })
            }
          >
            In der Wallet bestätigen
          </button>
        </Modal>
      )}
    </div>
  );
}
