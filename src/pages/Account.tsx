import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { PAYMENT_METHOD_LABEL, type OfferStatus } from "../../shared/constants";
import { formatAda, formatFiat, formatMargin, formatPrice } from "../../shared/money";
import { api, errorMessage } from "../api";
import { useAuth } from "../auth";
import { PlusIcon } from "../components/Icons";
import { CopyButton, EmptyState, ErrorNotice, formatDateTime, Spinner, StatusBadge } from "../components/Ui";
import { useDocumentTitle, useLoad } from "../hooks";

function TradesTab() {
  const { data, error, loading, reload } = useLoad(() => api.myTrades(), []);
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorNotice error={error} onRetry={() => void reload()} />;
  if (!data || data.trades.length === 0) {
    return (
      <EmptyState title="Noch keine Trades">
        <p className="muted">Starte einen Handel über ein Angebot im Marktplatz.</p>
        <Link to="/" className="btn btn-primary">
          Zum Marktplatz
        </Link>
      </EmptyState>
    );
  }
  return (
    <ul className="list">
      {data.trades.map((trade) => (
        <li key={trade.id}>
          <Link to={`/handel/${trade.id}`} className="list-row">
            <span className={`side-pill ${trade.role === "buyer" ? "side-buy" : "side-sell"}`}>
              {trade.role === "buyer" ? "Kauf" : "Verkauf"}
            </span>
            <span className="list-main">
              <strong>
                {formatAda(trade.lovelace)} · {formatFiat(trade.fiatCents, trade.fiat)}
              </strong>
              <span className="muted small">
                mit {trade.counterparty.displayName} · {formatDateTime(trade.createdAt)}
              </span>
            </span>
            <StatusBadge status={trade.status} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

const OFFER_STATUS_LABEL: Record<OfferStatus, string> = { active: "Aktiv", paused: "Pausiert", closed: "Geschlossen" };

function OffersTab({ created }: { created: boolean }) {
  const { data, error, loading, reload } = useLoad(() => api.myOffers(), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function setStatus(id: string, status: OfferStatus) {
    if (status === "closed" && !window.confirm("Angebot endgültig schließen? Laufende Trades sind davon nicht betroffen.")) return;
    setBusy(id);
    setActionError(null);
    try {
      await api.setOfferStatus(id, status);
      await reload();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorNotice error={error} onRetry={() => void reload()} />;
  return (
    <div className="stack">
      {created && <div className="notice notice-success">Dein Angebot ist veröffentlicht und im Marktplatz sichtbar.</div>}
      {actionError && <div className="notice notice-error">{actionError}</div>}
      <div>
        <Link to="/angebot/neu" className="btn btn-secondary">
          <PlusIcon size={16} /> Neues Angebot
        </Link>
      </div>
      {!data || data.offers.length === 0 ? (
        <EmptyState title="Keine offenen Angebote">
          <p className="muted">Mit einem eigenen Angebot finden dich Käufer oder Verkäufer im Marktplatz.</p>
        </EmptyState>
      ) : (
        <ul className="list">
          {data.offers.map((offer) => (
            <li key={offer.id} className="list-row list-row-static">
              <span className={`side-pill ${offer.side === "sell" ? "side-sell" : "side-buy"}`}>
                {offer.side === "sell" ? "Verkauf" : "Kauf"}
              </span>
              <span className="list-main">
                <Link to={`/angebot/${offer.id}`}>
                  <strong>
                    {offer.priceMicro != null ? formatPrice(offer.priceMicro, offer.fiat) : "–"} ·{" "}
                    {offer.priceType === "margin" ? formatMargin(offer.marginBps ?? 0) : "Festpreis"}
                  </strong>
                </Link>
                <span className="muted small">
                  {formatAda(offer.availableLovelace)} verfügbar · {formatFiat(offer.minFiatCents, offer.fiat)} –{" "}
                  {formatFiat(offer.maxFiatCents, offer.fiat)} · {offer.paymentMethods.map((m) => PAYMENT_METHOD_LABEL[m]).join(", ")}
                </span>
              </span>
              <span className={`status ${offer.status === "active" ? "status-completed" : "status-cancelled"}`}>
                {OFFER_STATUS_LABEL[offer.status]}
              </span>
              <span className="row-actions">
                {offer.status === "active" ? (
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy === offer.id} onClick={() => void setStatus(offer.id, "paused")}>
                    Pausieren
                  </button>
                ) : (
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy === offer.id} onClick={() => void setStatus(offer.id, "active")}>
                    Aktivieren
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm btn-danger-text"
                  disabled={busy === offer.id}
                  onClick={() => void setStatus(offer.id, "closed")}
                >
                  Schließen
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProfileTab() {
  const { me, setMe, logout } = useAuth();
  const [name, setName] = useState(me?.displayName ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  if (!me) return null;
  return (
    <div className="stack">
      <form
        className="card"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setMessage(null);
          try {
            const { user } = await api.updateMe(name.trim());
            setMe(user);
            setMessage({ ok: true, text: "Name gespeichert." });
          } catch (err) {
            setMessage({ ok: false, text: errorMessage(err) });
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2>Öffentlicher Name</h2>
        <label className="field">
          <span>Anzeigename</span>
          <input value={name} onChange={(event) => setName(event.target.value)} minLength={3} maxLength={24} required />
          <small className="muted">3–24 Zeichen. Verwende nicht deinen echten vollen Namen.</small>
        </label>
        {message && <div className={`notice ${message.ok ? "notice-success" : "notice-error"}`}>{message.text}</div>}
        <button type="submit" className="btn btn-primary" disabled={busy || name.trim() === me.displayName}>
          Speichern
        </button>
      </form>
      <section className="card">
        <h2>Wallet</h2>
        <dl className="facts facts-compact">
          <div>
            <dt>Konto (Stake-Adresse)</dt>
            <dd className="address-line">
              <code className="address">{me.identity}</code>
              <CopyButton value={me.identity} />
            </dd>
          </div>
          <div>
            <dt>Empfangsadresse für gekaufte ADA</dt>
            <dd className="address-line">
              <code className="address">{me.receiveAddress}</code>
              <CopyButton value={me.receiveAddress} />
            </dd>
          </div>
        </dl>
        <p className="muted small">
          Die Empfangsadresse wird bei jeder Anmeldung aus deiner Wallet übernommen. Laufende Trades behalten die Adresse vom
          Start des Handels.
        </p>
        <div className="form-actions form-actions-start">
          <Link to={`/nutzer/${me.id}`} className="btn btn-ghost">
            Öffentliches Profil ansehen
          </Link>
          <button type="button" className="btn btn-ghost" onClick={() => void logout()}>
            Abmelden
          </button>
        </div>
      </section>
    </div>
  );
}

const TABS = [
  { key: "", label: "Meine Trades" },
  { key: "angebote", label: "Meine Angebote" },
  { key: "profil", label: "Profil & Wallet" },
];

export function AccountPage() {
  useDocumentTitle("Mein Konto");
  const { me, ready, requireLogin } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") ?? "";

  if (!ready) return <div className="container section"><Spinner /></div>;
  if (!me) {
    return (
      <div className="container section narrow">
        <div className="card">
          <h1>Mein Konto</h1>
          <p className="muted">Melde dich mit deiner Cardano-Wallet an, um deine Trades und Angebote zu sehen.</p>
          <button type="button" className="btn btn-primary" onClick={() => void requireLogin().catch(() => undefined)}>
            Mit Wallet anmelden
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="container section">
      <h1>Mein Konto</h1>
      <div className="tabs tabs-underline" role="tablist">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            className={`tab ${tab === item.key ? "tab-active" : ""}`}
            onClick={() => setParams(item.key ? { tab: item.key } : {}, { replace: true })}
          >
            {item.label}
          </button>
        ))}
      </div>
      {tab === "angebote" ? <OffersTab created={params.get("neu") === "1"} /> : tab === "profil" ? <ProfileTab /> : <TradesTab />}
    </div>
  );
}
