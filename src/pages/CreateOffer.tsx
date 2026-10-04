import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { FIATS, PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type Fiat, type OfferSide, type PaymentMethod } from "../../shared/constants";
import { applyMargin, formatPrice, parsePriceToMicro } from "../../shared/money";
import { api, errorMessage } from "../api";
import { useAuth } from "../auth";
import { useDocumentTitle, usePrices } from "../hooks";

const WINDOWS = [15, 30, 45, 60, 90, 120];

export function CreateOfferPage() {
  useDocumentTitle("Angebot erstellen");
  const { me, requireLogin } = useAuth();
  const navigate = useNavigate();
  const prices = usePrices();

  const [side, setSide] = useState<OfferSide>("sell");
  const [fiat, setFiat] = useState<Fiat>("EUR");
  const [priceType, setPriceType] = useState<"fixed" | "margin">("margin");
  const [fixedPrice, setFixedPrice] = useState("");
  const [margin, setMargin] = useState("1");
  const [amountAda, setAmountAda] = useState("");
  const [minFiat, setMinFiat] = useState("20");
  const [maxFiat, setMaxFiat] = useState("300");
  const [methods, setMethods] = useState<PaymentMethod[]>(["SEPA"]);
  const [windowMin, setWindowMin] = useState(30);
  const [terms, setTerms] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const market = prices?.prices[fiat]?.priceMicro ?? null;
  const marginNumber = Number(margin.replace(",", "."));
  const effective =
    priceType === "fixed"
      ? parsePriceToMicro(fixedPrice)
      : market != null && Number.isFinite(marginNumber)
        ? applyMargin(market, Math.round(marginNumber * 100))
        : null;

  function toggleMethod(method: PaymentMethod) {
    setMethods((current) => (current.includes(method) ? current.filter((value) => value !== method) : [...current, method]));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (methods.length === 0) {
      setError("Bitte mindestens eine Zahlungsart wählen.");
      return;
    }
    if (priceType === "margin" && !Number.isFinite(marginNumber)) {
      setError("Bitte einen gültigen Auf- oder Abschlag in Prozent angeben.");
      return;
    }
    try {
      await requireLogin();
    } catch {
      return;
    }
    setBusy(true);
    try {
      await api.createOffer({
        side,
        fiat,
        priceType,
        fixedPrice: priceType === "fixed" ? fixedPrice : undefined,
        marginPercent: priceType === "margin" ? marginNumber : undefined,
        amountAda,
        minFiat,
        maxFiat,
        paymentMethods: methods,
        terms,
        paymentWindowMin: windowMin,
      });
      navigate("/konto?tab=angebote&neu=1");
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="container section narrow">
      <h1>Angebot erstellen</h1>
      <p className="lead muted">
        Lege fest, zu welchem Preis und mit welchen Zahlungsarten du handeln möchtest. Dein Angebot erscheint sofort im
        Marktplatz.
      </p>

      <form className="card form-grid" onSubmit={submit}>
        <fieldset className="field">
          <legend>Ich möchte</legend>
          <div className="segmented segmented-lg" role="radiogroup">
            <button type="button" role="radio" aria-checked={side === "sell"} onClick={() => setSide("sell")}>
              ADA verkaufen
            </button>
            <button type="button" role="radio" aria-checked={side === "buy"} onClick={() => setSide("buy")}>
              ADA kaufen
            </button>
          </div>
          <small className="muted">
            {side === "sell"
              ? "Käufer zahlen dir den Betrag, danach sendest du die ADA aus deiner Wallet."
              : "Du zahlst den Verkäufern den Betrag und erhältst die ADA an deine Wallet-Adresse."}
          </small>
        </fieldset>

        <label className="field">
          <span>Währung</span>
          <select value={fiat} onChange={(event) => setFiat(event.target.value as Fiat)}>
            {FIATS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="field">
          <legend>Preis</legend>
          <div className="segmented" role="radiogroup">
            <button type="button" role="radio" aria-checked={priceType === "margin"} onClick={() => setPriceType("margin")}>
              Marktpreis ± %
            </button>
            <button type="button" role="radio" aria-checked={priceType === "fixed"} onClick={() => setPriceType("fixed")}>
              Festpreis
            </button>
          </div>
          {priceType === "margin" ? (
            <div className="input-suffix">
              <input
                aria-label="Auf- oder Abschlag in Prozent"
                inputMode="decimal"
                value={margin}
                onChange={(event) => setMargin(event.target.value)}
                required
              />
              <span>%</span>
            </div>
          ) : (
            <div className="input-suffix">
              <input
                aria-label={`Festpreis pro ADA in ${fiat}`}
                inputMode="decimal"
                placeholder="0,45"
                value={fixedPrice}
                onChange={(event) => setFixedPrice(event.target.value)}
                required
              />
              <span>{fiat} / ADA</span>
            </div>
          )}
          <small className="muted">
            {market != null ? <>Marktpreis: {formatPrice(market, fiat)}. </> : "Marktpreis gerade nicht verfügbar. "}
            {effective != null && <>Dein Preis: <strong>{formatPrice(effective, fiat)}</strong> pro ADA.</>}
          </small>
        </fieldset>

        <label className="field">
          <span>{side === "sell" ? "Menge zum Verkauf" : "Gewünschte Menge"}</span>
          <div className="input-suffix">
            <input
              inputMode="decimal"
              placeholder="500"
              value={amountAda}
              onChange={(event) => setAmountAda(event.target.value)}
              required
            />
            <span>ADA</span>
          </div>
        </label>

        <div className="field-row">
          <label className="field">
            <span>Mindestbetrag pro Handel</span>
            <div className="input-suffix">
              <input inputMode="decimal" value={minFiat} onChange={(event) => setMinFiat(event.target.value)} required />
              <span>{fiat}</span>
            </div>
          </label>
          <label className="field">
            <span>Höchstbetrag pro Handel</span>
            <div className="input-suffix">
              <input inputMode="decimal" value={maxFiat} onChange={(event) => setMaxFiat(event.target.value)} required />
              <span>{fiat}</span>
            </div>
          </label>
        </div>

        <fieldset className="field">
          <legend>Zahlungsarten</legend>
          <div className="checkbox-grid">
            {PAYMENT_METHODS.map((method) => (
              <label key={method} className="checkbox">
                <input type="checkbox" checked={methods.includes(method)} onChange={() => toggleMethod(method)} />
                <span>{PAYMENT_METHOD_LABEL[method]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="field">
          <span>Zahlungsfrist</span>
          <select value={windowMin} onChange={(event) => setWindowMin(Number(event.target.value))}>
            {WINDOWS.map((value) => (
              <option key={value} value={value}>
                {value} Minuten
              </option>
            ))}
          </select>
          <small className="muted">So lange hat der Käufer nach dem Start eines Handels Zeit zu zahlen.</small>
        </label>

        <label className="field">
          <span>Bedingungen (optional)</span>
          <textarea
            rows={4}
            maxLength={1000}
            placeholder="z. B. Nur Überweisungen von einem Konto auf eigenen Namen. Antworte meist innerhalb von 10 Minuten."
            value={terms}
            onChange={(event) => setTerms(event.target.value)}
          />
          <small className="muted">Keine Bankdaten hier eintragen – die teilst du im Handels-Chat.</small>
        </label>

        {error && (
          <div className="notice notice-error" role="alert">
            {error}
          </div>
        )}

        <div className="form-actions">
          <Link to="/" className="btn btn-ghost">
            Abbrechen
          </Link>
          <button type="submit" className="btn btn-primary btn-lg" disabled={busy}>
            {busy ? "Wird veröffentlicht …" : me ? "Angebot veröffentlichen" : "Mit Wallet anmelden & veröffentlichen"}
          </button>
        </div>
      </form>
    </div>
  );
}
