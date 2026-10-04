import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { NEW_USER_MAX_FIAT_CENTS, NEW_USER_TRADE_THRESHOLD, PAYMENT_METHOD_LABEL, type PaymentMethod } from "../../shared/constants";
import {
  fiatCentsFor,
  formatAda,
  formatFiat,
  formatMargin,
  formatPrice,
  lovelaceFor,
  parseAdaToLovelace,
  parseFiatToCents,
} from "../../shared/money";
import type { Offer } from "../../shared/types";
import { api, errorMessage } from "../api";
import { useAuth } from "../auth";
import { ClockIcon, ShieldIcon } from "../components/Icons";
import { ErrorNotice, Spinner, TraderLine } from "../components/Ui";
import { useDocumentTitle, useLoad } from "../hooks";

function TradeForm({ offer }: { offer: Offer }) {
  const { me, requireLogin } = useAuth();
  const navigate = useNavigate();
  const [amountType, setAmountType] = useState<"fiat" | "ada">("fiat");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>(offer.paymentMethods[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const youBuy = offer.side === "sell";
  const isOwn = me?.id === offer.maker.id;
  const price = offer.priceMicro;

  let preview: { lovelace: number; cents: number } | null = null;
  if (price != null && amount.trim()) {
    if (amountType === "fiat") {
      const cents = parseFiatToCents(amount);
      if (cents) preview = { cents, lovelace: lovelaceFor(cents, price) };
    } else {
      const lovelace = parseAdaToLovelace(amount);
      if (lovelace) preview = { lovelace, cents: fiatCentsFor(lovelace, price) };
    }
  }

  const max = offer.effectiveMaxFiatCents ?? offer.maxFiatCents;
  const outOfRange = preview != null && (preview.cents < offer.minFiatCents || preview.cents > max);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await requireLogin();
    } catch {
      return;
    }
    setBusy(true);
    try {
      const { tradeId } = await api.startTrade(offer.id, { amountType, amount: amount.trim(), paymentMethod: method });
      navigate(`/handel/${tradeId}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  if (isOwn) {
    return (
      <div className="card">
        <h2>Dein Angebot</h2>
        <p className="muted">Andere Händler sehen dieses Angebot im Marktplatz. Verwalten kannst du es in deinem Konto.</p>
        <Link to="/konto?tab=angebote" className="btn btn-secondary">
          Meine Angebote
        </Link>
      </div>
    );
  }

  return (
    <form className="card trade-form" onSubmit={submit}>
      <h2>{youBuy ? "ADA kaufen" : "ADA verkaufen"}</h2>
      <div className="segmented" role="radiogroup" aria-label="Betrag angeben in">
        <button type="button" role="radio" aria-checked={amountType === "fiat"} onClick={() => setAmountType("fiat")}>
          in {offer.fiat}
        </button>
        <button type="button" role="radio" aria-checked={amountType === "ada"} onClick={() => setAmountType("ada")}>
          in ADA
        </button>
      </div>
      <label className="field">
        <span>{amountType === "fiat" ? `Betrag in ${offer.fiat}` : "Menge in ADA"}</span>
        <div className="input-suffix">
          <input
            required
            inputMode="decimal"
            autoComplete="off"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder={amountType === "fiat" ? (offer.minFiatCents / 100).toString() : "100"}
            aria-describedby="trade-limits"
          />
          <span>{amountType === "fiat" ? offer.fiat : "ADA"}</span>
        </div>
        <small id="trade-limits" className="muted">
          Limit: {formatFiat(offer.minFiatCents, offer.fiat)} – {formatFiat(max, offer.fiat)}
        </small>
      </label>

      <div className={`preview ${outOfRange ? "preview-warn" : ""}`} aria-live="polite">
        {preview ? (
          <>
            <div>
              <span className="muted small">{youBuy ? "Du zahlst" : "Du erhältst"}</span>
              <strong>{formatFiat(preview.cents, offer.fiat)}</strong>
            </div>
            <div>
              <span className="muted small">{youBuy ? "Du erhältst" : "Du sendest"}</span>
              <strong>{formatAda(preview.lovelace)}</strong>
            </div>
          </>
        ) : (
          <span className="muted small">Gib einen Betrag ein, um die Umrechnung zu sehen.</span>
        )}
      </div>
      {outOfRange && <p className="field-error">Der Betrag liegt außerhalb des Limits dieses Angebots.</p>}

      <label className="field">
        <span>Zahlungsart</span>
        <select value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod)}>
          {offer.paymentMethods.map((value) => (
            <option key={value} value={value}>
              {PAYMENT_METHOD_LABEL[value]}
            </option>
          ))}
        </select>
      </label>

      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}
      <div className="notice notice-warn small">
        <strong>Ohne Treuhand.</strong>{" "}
        {youBuy
          ? "Du zahlst zuerst, der Verkäufer sendet danach die ADA. Liefert er nicht, kann die Moderation das Konto sperren, aber dein Geld nicht zurückholen."
          : "Der Käufer zahlt zuerst. Sende die ADA erst, wenn das Geld auf deinem Konto gutgeschrieben ist."}{" "}
        Starte mit kleinen Beträgen.
      </div>
      <button type="submit" className={`btn btn-lg btn-block ${youBuy ? "btn-buy" : "btn-sell"}`} disabled={busy || !amount.trim()}>
        {busy ? "Handel wird gestartet …" : me ? "Handel starten" : "Mit Wallet anmelden & starten"}
      </button>
      <p className="muted small">
        Beim Start wird die Menge im Angebot für dich reserviert. {youBuy ? "Du hast" : "Dein Gegenüber hat"} dann{" "}
        {offer.paymentWindowMin} Minuten Zeit für die Zahlung.
      </p>
    </form>
  );
}

export function OfferDetailPage() {
  const { id = "" } = useParams();
  const { data, error, loading, reload } = useLoad(() => api.offer(id), [id]);
  const offer = data?.offer;
  useDocumentTitle(offer ? `${offer.side === "sell" ? "ADA kaufen" : "ADA verkaufen"} bei ${offer.maker.displayName}` : "Angebot");

  if (loading && !offer) return <div className="container section"><Spinner /></div>;
  if (error || !offer) {
    return (
      <div className="container section">
        <ErrorNotice error={error ?? new Error("Angebot nicht gefunden.")} onRetry={() => void reload()} />
        <Link to="/" className="btn btn-ghost">
          Zurück zum Marktplatz
        </Link>
      </div>
    );
  }

  const youBuy = offer.side === "sell";
  return (
    <div className="container section">
      <nav className="breadcrumbs" aria-label="Brotkrumen">
        <Link to="/">Marktplatz</Link> <span aria-hidden="true">/</span> <span>Angebot</span>
      </nav>
      <div className="two-col">
        <div className="stack">
          <section className="card">
            <p className="eyebrow">{youBuy ? "Verkauft ADA" : "Kauft ADA"}</p>
            <TraderLine user={offer.maker} />
            <dl className="facts">
              <div>
                <dt>Preis pro ADA</dt>
                <dd>
                  <strong className="price">{offer.priceMicro != null ? formatPrice(offer.priceMicro, offer.fiat) : "–"}</strong>
                  <span className="muted small">
                    {offer.priceType === "margin" ? formatMargin(offer.marginBps ?? 0) : "Festpreis"}
                  </span>
                </dd>
              </div>
              <div>
                <dt>Verfügbar</dt>
                <dd>{formatAda(offer.availableLovelace)}</dd>
              </div>
              <div>
                <dt>Limit pro Handel</dt>
                <dd>
                  {formatFiat(offer.minFiatCents, offer.fiat)} – {formatFiat(offer.effectiveMaxFiatCents ?? offer.maxFiatCents, offer.fiat)}
                </dd>
              </div>
              <div>
                <dt>Zahlungsfrist</dt>
                <dd>
                  <span className="with-icon">
                    <ClockIcon size={16} /> {offer.paymentWindowMin} Minuten
                  </span>
                </dd>
              </div>
              <div>
                <dt>Zahlungsarten</dt>
                <dd className="chips">
                  {offer.paymentMethods.map((method) => (
                    <span key={method} className="chip">
                      {PAYMENT_METHOD_LABEL[method]}
                    </span>
                  ))}
                </dd>
              </div>
            </dl>
            {offer.terms && (
              <div className="terms">
                <h3>Bedingungen des Händlers</h3>
                <p>{offer.terms}</p>
              </div>
            )}
          </section>
          <section className="card card-muted">
            <h3>
              <ShieldIcon size={18} /> So bleibst du sicher
            </h3>
            <ul className="tips">
              <li>Kommuniziere und teile Zahlungsdaten nur im Handels-Chat – nie über Telegram, WhatsApp o. Ä.</li>
              <li>Zahle nur von einem Konto auf deinen eigenen Namen – Zahlungen über Dritte sind verboten.</li>
              <li>Verkäufer: ADA erst senden, wenn das Geld wirklich auf dem Konto ist – nicht auf Screenshots verlassen.</li>
              <li>
                Solange eine Seite weniger als {NEW_USER_TRADE_THRESHOLD} abgeschlossene Trades hat, gilt ein Limit von{" "}
                {formatFiat(NEW_USER_MAX_FIAT_CENTS, offer.fiat)} pro Handel.
              </li>
            </ul>
          </section>
        </div>
        <TradeForm offer={offer} />
      </div>
    </div>
  );
}
