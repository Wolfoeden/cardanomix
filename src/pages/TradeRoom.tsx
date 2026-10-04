import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { PAYMENT_METHOD_LABEL } from "../../shared/constants";
import { formatAda, formatFiat, formatPrice, lovelaceToAdaString } from "../../shared/money";
import type { Trade, TradeMessage } from "../../shared/types";
import { api, errorMessage } from "../api";
import { useAuth } from "../auth";
import { AlertIcon, ChainIcon, ChatIcon, CheckIcon, ClockIcon, ExternalIcon, ThumbDownIcon, ThumbUpIcon } from "../components/Icons";
import { Avatar, CopyButton, ErrorNotice, formatDateTime, formatRemaining, Modal, Spinner, StatusBadge } from "../components/Ui";
import { useConfig, useDocumentTitle, useInterval, useNow } from "../hooks";

function explorerUrl(network: string | undefined, hash: string): string {
  return network === "preprod" ? `https://preprod.cardanoscan.io/transaction/${hash}` : `https://cardanoscan.io/transaction/${hash}`;
}

function Steps({ trade }: { trade: Trade }) {
  const steps = ["Handel gestartet", "Fiat bezahlt", "ADA gesendet", "Abgeschlossen"];
  let done = 1;
  if (trade.status === "paid" || trade.status === "disputed") done = trade.txHash ? 3 : 2;
  if (trade.status === "completed") done = 4;
  if (trade.status === "cancelled") done = trade.paidAt ? 2 : 1;
  return (
    <ol className={`steps ${trade.status === "cancelled" ? "steps-cancelled" : ""}`} aria-label="Fortschritt">
      {steps.map((step, index) => (
        <li key={step} className={index < done ? "step-done" : index === done ? "step-current" : ""}>
          <span className="step-dot">{index < done ? <CheckIcon size={14} /> : index + 1}</span>
          <span>{step}</span>
        </li>
      ))}
    </ol>
  );
}

function Confirm({
  title,
  children,
  confirmLabel,
  tone = "primary",
  onConfirm,
  onClose,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  tone?: "primary" | "danger" | "buy";
  onConfirm: () => Promise<void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title={title} onClose={onClose}>
      <div className="stack">
        {children}
        {error && (
          <div className="notice notice-error" role="alert">
            {error}
          </div>
        )}
        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Zurück
          </button>
          <button
            type="button"
            className={`btn btn-${tone}`}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onConfirm();
                onClose();
              } catch (err) {
                setError(errorMessage(err));
                setBusy(false);
              }
            }}
          >
            {busy ? "Bitte warten …" : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function AddressBox({ trade }: { trade: Trade }) {
  return (
    <div className="address-box">
      <div>
        <span className="muted small">Betrag</span>
        <div className="address-line">
          <strong>{formatAda(trade.lovelace)}</strong>
          <CopyButton value={lovelaceToAdaString(trade.lovelace)} label="Betrag kopieren" />
        </div>
      </div>
      <div>
        <span className="muted small">Käuferadresse</span>
        <div className="address-line">
          <code className="address">{trade.buyerAddress}</code>
          <CopyButton value={trade.buyerAddress} label="Adresse kopieren" />
        </div>
      </div>
    </div>
  );
}

function ReleaseForm({ trade, onDone }: { trade: Trade; onDone: (trade: Trade) => void }) {
  const [hash, setHash] = useState(trade.txHash ?? "");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const response = await api.release(trade.id, hash.trim());
      setResult(response.verification);
      onDone(response.trade);
    } catch (err) {
      setResult({ ok: false, message: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <label className="field">
        <span>Transaktions-ID (Tx-Hash) deiner ADA-Zahlung</span>
        <input
          value={hash}
          onChange={(event) => setHash(event.target.value)}
          placeholder="64 Zeichen, z. B. aus deiner Wallet-Historie"
          spellCheck={false}
          autoComplete="off"
          pattern="[0-9a-fA-F]{64}"
          title="64 Hex-Zeichen"
          required
        />
      </label>
      <button type="submit" className="btn btn-primary" disabled={busy}>
        <ChainIcon size={16} />
        {busy ? "Prüfe auf der Blockchain …" : trade.txHash ? "Erneut prüfen" : "Zahlung prüfen & abschließen"}
      </button>
      {result && (
        <div className={`notice ${result.ok ? "notice-success" : "notice-warn"}`} role="status">
          {result.message}
        </div>
      )}
    </form>
  );
}

function RatingForm({ trade, onDone }: { trade: Trade; onDone: () => void }) {
  const [positive, setPositive] = useState<boolean | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const other = trade.role === "buyer" ? trade.seller : trade.buyer;
  return (
    <form
      className="stack"
      onSubmit={async (event) => {
        event.preventDefault();
        if (positive == null) return;
        setBusy(true);
        try {
          await api.rate(trade.id, positive, comment);
          onDone();
        } catch (err) {
          setError(errorMessage(err));
          setBusy(false);
        }
      }}
    >
      <p>Wie lief der Handel mit {other.displayName}?</p>
      <div className="rating-choice" role="radiogroup" aria-label="Bewertung">
        <button type="button" role="radio" aria-checked={positive === true} className="rate-up" onClick={() => setPositive(true)}>
          <ThumbUpIcon /> Positiv
        </button>
        <button type="button" role="radio" aria-checked={positive === false} className="rate-down" onClick={() => setPositive(false)}>
          <ThumbDownIcon /> Negativ
        </button>
      </div>
      <textarea
        rows={2}
        maxLength={500}
        placeholder="Kurzer Kommentar (optional)"
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        aria-label="Kommentar"
      />
      {error && <div className="notice notice-error">{error}</div>}
      <button type="submit" className="btn btn-primary" disabled={busy || positive == null}>
        Bewertung abgeben
      </button>
    </form>
  );
}

function ResolveForm({ trade, onDone }: { trade: Trade; onDone: () => void }) {
  const [outcome, setOutcome] = useState<"completed" | "cancelled">("cancelled");
  const [fault, setFault] = useState<"buyer" | "seller" | "none">("none");
  const [note, setNote] = useState("");
  const [ban, setBan] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="stack"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await api.resolve(trade.id, { outcome, fault, note, banFaultUser: ban });
          onDone();
        } catch (err) {
          setError(errorMessage(err));
          setBusy(false);
        }
      }}
    >
      <div className="field-row">
        <label className="field">
          <span>Ergebnis</span>
          <select value={outcome} onChange={(event) => setOutcome(event.target.value as typeof outcome)}>
            <option value="completed">Abschließen (ADA wurden gesendet)</option>
            <option value="cancelled">Abbrechen</option>
          </select>
        </label>
        <label className="field">
          <span>Verantwortlich</span>
          <select value={fault} onChange={(event) => setFault(event.target.value as typeof fault)}>
            <option value="none">Niemand</option>
            <option value="buyer">Käufer ({trade.buyer.displayName})</option>
            <option value="seller">Verkäufer ({trade.seller.displayName})</option>
          </select>
        </label>
      </div>
      <label className="field">
        <span>Begründung (für beide sichtbar)</span>
        <textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} required minLength={5} />
      </label>
      <label className="checkbox">
        <input type="checkbox" checked={ban} disabled={fault === "none"} onChange={(event) => setBan(event.target.checked)} />
        <span>Verantwortliches Konto sperren und Angebote schließen</span>
      </label>
      {error && <div className="notice notice-error">{error}</div>}
      <button type="submit" className="btn btn-primary" disabled={busy}>
        Entscheidung speichern
      </button>
    </form>
  );
}

type Dialog = "paid" | "cancel" | "confirm" | "dispute" | null;

function ActionPanel({ trade, reload, setTrade }: { trade: Trade; reload: () => Promise<void>; setTrade: (trade: Trade) => void }) {
  const config = useConfig();
  const now = useNow();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [reason, setReason] = useState("");
  const remaining = new Date(trade.paymentDeadline).getTime() - now;
  const can = (action: Trade["actions"][number]) => trade.actions.includes(action);
  const fiat = formatFiat(trade.fiatCents, trade.fiat);
  const ada = formatAda(trade.lovelace);

  let body: ReactNode = null;
  if (trade.status === "awaiting_payment") {
    body =
      trade.role === "buyer" ? (
        <>
          <h3>Bitte {fiat} bezahlen</h3>
          <p>
            Überweise genau <strong>{fiat}</strong> per {PAYMENT_METHOD_LABEL[trade.paymentMethod]} an{" "}
            {trade.seller.displayName}. Die Zahlungsdaten bekommst du im Chat. Markiere die Zahlung danach als erledigt.
          </p>
        </>
      ) : (
        <>
          <h3>Warte auf die Zahlung</h3>
          <p>
            {trade.buyer.displayName} überweist dir <strong>{fiat}</strong> per {PAYMENT_METHOD_LABEL[trade.paymentMethod]}.
            Teile deine Zahlungsdaten im Chat. Sende noch keine ADA.
          </p>
        </>
      );
  } else if (trade.status === "paid") {
    body =
      trade.role === "seller" ? (
        <>
          <h3>Zahlungseingang prüfen, dann ADA senden</h3>
          <p>
            Der Käufer hat die Zahlung als erledigt markiert. Prüfe in deinem Konto, ob <strong>{fiat}</strong> eingegangen
            sind. Erst dann sendest du <strong>{ada}</strong> an diese Adresse und trägst den Tx-Hash ein:
          </p>
          <AddressBox trade={trade} />
          <ReleaseForm trade={trade} onDone={setTrade} />
        </>
      ) : (
        <>
          <h3>Der Verkäufer ist am Zug</h3>
          <p>
            {trade.seller.displayName} prüft deine Zahlung und sendet dann <strong>{ada}</strong> an deine Adresse. Sobald
            die Transaktion auf der Blockchain bestätigt ist, schließt sich der Handel automatisch ab.
          </p>
          <p className="muted small">
            Deine Empfangsadresse: <code className="address">{trade.buyerAddress}</code>
          </p>
        </>
      );
  } else if (trade.status === "disputed") {
    body = (
      <>
        <h3>
          <AlertIcon size={18} /> Streitfall in Prüfung
        </h3>
        <p>
          Die Moderation prüft den Handel. Stelle Belege wie Zahlungsnachweise im Chat bereit.
          {trade.disputeReason && (
            <>
              <br />
              <span className="muted">Begründung: „{trade.disputeReason}“</span>
            </>
          )}
        </p>
        {trade.role === "seller" && can("release") && (
          <>
            <p className="muted small">Hast du die ADA inzwischen gesendet? Dann trage den Tx-Hash ein:</p>
            <AddressBox trade={trade} />
            <ReleaseForm trade={trade} onDone={setTrade} />
          </>
        )}
        {can("resolve") && <ResolveForm trade={trade} onDone={() => void reload()} />}
      </>
    );
  } else if (trade.status === "completed") {
    body = (
      <>
        <h3 className="success-title">
          <CheckIcon /> Handel abgeschlossen
        </h3>
        <p>
          {ada} gegen {fiat}.{" "}
          {trade.completionNote === "onchain" && "Die ADA-Zahlung wurde auf der Blockchain bestätigt."}
          {trade.completionNote === "buyer_confirmed" && "Der Käufer hat den Erhalt der ADA bestätigt."}
          {trade.completionNote === "admin" && "Die Moderation hat den Handel abgeschlossen."}
        </p>
        {trade.txHash && (
          <p>
            <a href={explorerUrl(config?.network, trade.txHash)} target="_blank" rel="noreferrer" className="link-external">
              Transaktion im Explorer ansehen <ExternalIcon size={14} />
            </a>
          </p>
        )}
        {can("rate") && <RatingForm trade={trade} onDone={() => void reload()} />}
      </>
    );
  } else if (trade.status === "cancelled") {
    body = (
      <>
        <h3>Handel abgebrochen</h3>
        <p className="muted">
          {trade.cancelReason === "buyer_cancelled" && "Der Käufer hat den Handel abgebrochen."}
          {trade.cancelReason === "expired" && "Die Zahlungsfrist ist abgelaufen."}
          {trade.cancelReason === "admin" && "Die Moderation hat den Handel abgebrochen."} Die reservierte Menge ist wieder im
          Angebot verfügbar.
        </p>
      </>
    );
  }

  return (
    <section className="card action-panel" aria-live="polite">
      {trade.status === "awaiting_payment" && (
        <div className={`countdown ${remaining <= 0 ? "countdown-over" : remaining < 5 * 60_000 ? "countdown-soon" : ""}`}>
          <ClockIcon size={16} />
          {remaining > 0 ? (
            <>
              Zahlungsfrist: <strong>{formatRemaining(remaining)}</strong>
            </>
          ) : (
            <>Zahlungsfrist abgelaufen</>
          )}
        </div>
      )}
      {body}
      <div className="action-buttons">
        {can("mark_paid") && (
          <button type="button" className="btn btn-buy btn-lg" onClick={() => setDialog("paid")}>
            Ich habe bezahlt
          </button>
        )}
        {can("confirm_receipt") && (
          <button type="button" className="btn btn-buy" onClick={() => setDialog("confirm")}>
            ADA erhalten – abschließen
          </button>
        )}
        {can("cancel") && (
          <button type="button" className="btn btn-ghost" onClick={() => setDialog("cancel")}>
            Handel abbrechen
          </button>
        )}
        {can("dispute") && (
          <button type="button" className="btn btn-ghost btn-danger-text" onClick={() => setDialog("dispute")}>
            Streitfall eröffnen
          </button>
        )}
      </div>

      {dialog === "paid" && (
        <Confirm
          title="Zahlung bestätigen"
          confirmLabel="Ja, ich habe bezahlt"
          tone="buy"
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await api.markPaid(trade.id);
            await reload();
          }}
        >
          <p>
            Hast du <strong>{fiat}</strong> wirklich an {trade.seller.displayName} überwiesen? Falsche Angaben führen zur
            Sperrung des Kontos.
          </p>
        </Confirm>
      )}
      {dialog === "cancel" && (
        <Confirm
          title="Handel abbrechen"
          confirmLabel="Handel abbrechen"
          tone="danger"
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await api.cancel(trade.id);
            await reload();
          }}
        >
          <p>
            {trade.role === "buyer"
              ? "Brich nur ab, wenn du noch nicht bezahlt hast. Ein Abbruch zählt in deine Abschlussquote."
              : "Die Zahlungsfrist ist abgelaufen. Hast du trotzdem Geld erhalten, brich nicht ab, sondern kläre es im Chat."}
          </p>
        </Confirm>
      )}
      {dialog === "confirm" && (
        <Confirm
          title="ADA erhalten?"
          confirmLabel="Ja, ADA sind angekommen"
          tone="buy"
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await api.confirm(trade.id);
            await reload();
          }}
        >
          <p>
            Bestätige nur, wenn <strong>{ada}</strong> in deiner Wallet angekommen sind. Der Handel wird damit
            abgeschlossen.
          </p>
        </Confirm>
      )}
      {dialog === "dispute" && (
        <Confirm
          title="Streitfall eröffnen"
          confirmLabel="Streitfall eröffnen"
          tone="danger"
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await api.dispute(trade.id, reason);
            await reload();
          }}
        >
          <p className="muted">
            Beschreibe kurz, was nicht stimmt. Die Moderation sieht sich den Chat an und entscheidet. Versuche es vorher im
            Chat zu klären.
          </p>
          <textarea
            rows={4}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            aria-label="Begründung"
            placeholder="z. B. Zahlung vor 2 Stunden gesendet, Verkäufer reagiert nicht."
          />
        </Confirm>
      )}
    </section>
  );
}

function Chat({
  trade,
  messages,
  onSent,
}: {
  trade: Trade;
  messages: TradeMessage[];
  onSent: () => Promise<void>;
}) {
  const { me } = useAuth();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages.length]);

  function senderName(message: TradeMessage): string {
    if (message.senderId === trade.buyer.id) return trade.buyer.displayName;
    if (message.senderId === trade.seller.id) return trade.seller.displayName;
    return "Moderation";
  }

  return (
    <section className="card chat" aria-labelledby="chat-title">
      <h2 id="chat-title">
        <ChatIcon size={18} /> Chat
      </h2>
      <ol className="chat-list" ref={listRef} aria-live="polite">
        {messages.map((message) =>
          message.senderId == null ? (
            <li key={message.id} className="chat-system">
              <span>{message.body}</span>
              <time dateTime={message.createdAt}>{formatDateTime(message.createdAt)}</time>
            </li>
          ) : (
            <li key={message.id} className={`chat-message ${message.senderId === me?.id ? "chat-own" : ""}`}>
              <span className="chat-meta">
                {senderName(message)} · <time dateTime={message.createdAt}>{formatDateTime(message.createdAt)}</time>
              </span>
              <span className="chat-bubble">{message.body}</span>
            </li>
          ),
        )}
      </ol>
      <form
        className="chat-form"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!text.trim()) return;
          setBusy(true);
          setError(null);
          try {
            await api.sendMessage(trade.id, text.trim());
            setText("");
            await onSent();
          } catch (err) {
            setError(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <textarea
          rows={2}
          maxLength={2000}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder="Nachricht schreiben …"
          aria-label="Nachricht"
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !text.trim()}>
          Senden
        </button>
      </form>
      {error && <div className="notice notice-error">{error}</div>}
      <p className="muted small">Teile Zahlungsdaten nur hier. Die Moderation kann den Chat bei Streitfällen einsehen.</p>
    </section>
  );
}

export function TradeRoomPage() {
  const { id = "" } = useParams();
  const { me, ready, requireLogin } = useAuth();
  const [trade, setTrade] = useState<Trade | null>(null);
  const [messages, setMessages] = useState<TradeMessage[]>([]);
  const [error, setError] = useState<unknown>(null);
  const lastId = useRef(0);
  useDocumentTitle(trade ? `Handel · ${formatAda(trade.lovelace)}` : "Handel");

  async function load(full = false) {
    try {
      const detail = await api.trade(id, full ? 0 : lastId.current);
      setTrade(detail.trade);
      if (detail.messages.length > 0) {
        lastId.current = Math.max(lastId.current, detail.messages[detail.messages.length - 1].id);
        setMessages((current) => {
          if (full) return detail.messages;
          // Parallele Abrufe (Intervall + Aktion) können dieselben Nachrichten liefern.
          const known = new Set(current.map((message) => message.id));
          return [...current, ...detail.messages.filter((message) => !known.has(message.id))];
        });
      }
      setError(null);
    } catch (err) {
      setError(err);
    }
  }

  useEffect(() => {
    lastId.current = 0;
    setMessages([]);
    setTrade(null);
    if (me) void load(true);
  }, [id, me?.id]);

  const active = trade && ["awaiting_payment", "paid", "disputed"].includes(trade.status);
  useInterval(() => {
    if (me && document.visibilityState === "visible") void load();
  }, me ? (active ? 4000 : 15000) : null);

  if (!ready) return <div className="container section"><Spinner /></div>;
  if (!me) {
    return (
      <div className="container section narrow">
        <div className="card">
          <h1>Anmeldung erforderlich</h1>
          <p className="muted">Trades sind nur für die beiden Handelspartner sichtbar.</p>
          <button type="button" className="btn btn-primary" onClick={() => void requireLogin().catch(() => undefined)}>
            Mit Wallet anmelden
          </button>
        </div>
      </div>
    );
  }
  if (error && !trade) {
    return (
      <div className="container section">
        <ErrorNotice error={error} onRetry={() => void load(true)} />
      </div>
    );
  }
  if (!trade) return <div className="container section"><Spinner label="Handel wird geladen …" /></div>;

  const counterpart = trade.role === "buyer" ? trade.seller : trade.buyer;
  const youBuy = trade.role === "buyer";

  return (
    <div className="container section">
      <nav className="breadcrumbs" aria-label="Brotkrumen">
        <Link to="/konto">Meine Trades</Link> <span aria-hidden="true">/</span> <span>Handel</span>
      </nav>
      <header className="trade-head">
        <div>
          <p className="eyebrow">
            {trade.role === "admin" ? "Moderation" : youBuy ? "Du kaufst ADA" : "Du verkaufst ADA"}
          </p>
          <h1>
            {formatAda(trade.lovelace)} <span className="muted">für</span> {formatFiat(trade.fiatCents, trade.fiat)}
          </h1>
        </div>
        <StatusBadge status={trade.status} />
      </header>
      <Steps trade={trade} />
      <div className="trade-grid">
        <div className="stack">
          <ActionPanel trade={trade} reload={() => load()} setTrade={setTrade} />
          <section className="card">
            <h2>Details</h2>
            <dl className="facts facts-compact">
              <div>
                <dt>{trade.role === "admin" ? "Käufer / Verkäufer" : "Handelspartner"}</dt>
                <dd>
                  {trade.role === "admin" ? (
                    <>
                      <Link to={`/nutzer/${trade.buyer.id}`}>{trade.buyer.displayName}</Link> /{" "}
                      <Link to={`/nutzer/${trade.seller.id}`}>{trade.seller.displayName}</Link>
                    </>
                  ) : (
                    <span className="inline-user">
                      <Avatar user={counterpart} size={22} />
                      <Link to={`/nutzer/${counterpart.id}`}>{counterpart.displayName}</Link>
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt>Preis</dt>
                <dd>{formatPrice(trade.priceMicro, trade.fiat)} pro ADA</dd>
              </div>
              <div>
                <dt>Zahlungsart</dt>
                <dd>{PAYMENT_METHOD_LABEL[trade.paymentMethod]}</dd>
              </div>
              <div>
                <dt>Gestartet</dt>
                <dd>{formatDateTime(trade.createdAt)}</dd>
              </div>
              {trade.txHash && (
                <div>
                  <dt>Tx-Hash</dt>
                  <dd>
                    <code className="address">{trade.txHash}</code>
                  </dd>
                </div>
              )}
            </dl>
            {trade.terms && (
              <div className="terms">
                <h3>Bedingungen des Anbieters</h3>
                <p>{trade.terms}</p>
              </div>
            )}
            {trade.ratings.length > 0 && (
              <div className="terms">
                <h3>Bewertungen</h3>
                <ul className="rating-list">
                  {trade.ratings.map((rating) => (
                    <li key={rating.rater.id}>
                      {rating.positive ? <ThumbUpIcon className="up" /> : <ThumbDownIcon className="down" />}
                      <span>
                        <strong>{rating.rater.displayName}</strong>
                        {rating.comment && <>: {rating.comment}</>}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        </div>
        <Chat trade={trade} messages={messages} onSent={() => load()} />
      </div>
    </div>
  );
}
