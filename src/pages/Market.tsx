import { Link, useSearchParams } from "react-router";
import { FIATS, PAYMENT_METHODS, PAYMENT_METHOD_LABEL, type Fiat, type OfferSide, type PaymentMethod } from "../../shared/constants";
import { formatAda, formatFiat, formatMargin, formatPrice } from "../../shared/money";
import type { Offer } from "../../shared/types";
import { api } from "../api";
import { ArrowRightIcon, ChainIcon, PlusIcon, ShieldIcon, WalletIcon } from "../components/Icons";
import { EmptyState, ErrorNotice, Spinner, TraderLine } from "../components/Ui";
import { useDocumentTitle, useLoad, usePrices } from "../hooks";

function Hero() {
  const prices = usePrices();
  const stats = useLoad(() => api.stats(), []);
  return (
    <section className="hero">
      <div className="container hero-inner">
        <div className="hero-copy">
          <p className="eyebrow">Cardano · Peer-to-Peer</p>
          <h1>ADA direkt von Mensch zu Mensch handeln</h1>
          <p className="lead">
            Kaufe und verkaufe ADA gegen Euro, Franken, Dollar oder Pfund. Ohne Börsenkonto, ohne Verwahrung: Das Geld
            geht direkt an dein Gegenüber, die ADA direkt in deine Wallet.
          </p>
          <ul className="hero-points">
            <li>
              <WalletIcon /> Anmeldung nur mit deiner Cardano-Wallet
            </li>
            <li>
              <ChainIcon /> ADA-Zahlung wird auf der Blockchain geprüft
            </li>
            <li>
              <ShieldIcon /> Bewertungen, Limits für neue Konten und Moderation
            </li>
          </ul>
        </div>
        <div className="hero-panel" aria-label="Marktdaten">
          <div className="hero-panel-head">
            <span>ADA-Kurs</span>
            {prices?.source && <span className="muted small">Quelle: {prices.source}</span>}
          </div>
          <div className="price-grid">
            {FIATS.map((fiat) => {
              const price = prices?.prices[fiat];
              return (
                <div key={fiat} className="price-cell">
                  <span className="muted small">{fiat}</span>
                  <strong>{price ? formatPrice(price.priceMicro, fiat) : "–"}</strong>
                  {price?.change24h != null && (
                    <span className={`small ${price.change24h >= 0 ? "up" : "down"}`}>
                      {price.change24h >= 0 ? "+" : "−"}
                      {Math.abs(price.change24h).toFixed(2).replace(".", ",")} % (24 h)
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="stat-row">
            <div>
              <strong>{stats.data?.activeOffers ?? "–"}</strong>
              <span>aktive Angebote</span>
            </div>
            <div>
              <strong>{stats.data?.completedTrades ?? "–"}</strong>
              <span>abgeschlossene Trades</span>
            </div>
            <div>
              <strong>{stats.data?.traders ?? "–"}</strong>
              <span>Händler</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function OfferRow({ offer, side }: { offer: Offer; side: OfferSide }) {
  const youBuy = side === "sell";
  return (
    <li className="offer-row">
      <div className="offer-cell offer-trader">
        <TraderLine user={offer.maker} />
      </div>
      <div className="offer-cell offer-price">
        <span className="label">Preis pro ADA</span>
        <strong className="price">{offer.priceMicro != null ? formatPrice(offer.priceMicro, offer.fiat) : "–"}</strong>
        <span className="muted small">{offer.priceType === "margin" ? formatMargin(offer.marginBps ?? 0) : "Festpreis"}</span>
      </div>
      <div className="offer-cell offer-limits">
        <span className="label">Verfügbar / Limit</span>
        <span>{formatAda(offer.availableLovelace)}</span>
        <span className="muted small">
          {formatFiat(offer.minFiatCents, offer.fiat)} – {formatFiat(offer.effectiveMaxFiatCents ?? offer.maxFiatCents, offer.fiat)}
        </span>
      </div>
      <div className="offer-cell offer-methods">
        <span className="label">Zahlung</span>
        <div className="chips">
          {offer.paymentMethods.map((method) => (
            <span key={method} className="chip">
              {PAYMENT_METHOD_LABEL[method]}
            </span>
          ))}
        </div>
      </div>
      <div className="offer-cell offer-action">
        <Link to={`/angebot/${offer.id}`} className={`btn ${youBuy ? "btn-buy" : "btn-sell"}`}>
          {youBuy ? "ADA kaufen" : "ADA verkaufen"}
          <ArrowRightIcon size={16} />
        </Link>
      </div>
    </li>
  );
}

export function MarketPage() {
  useDocumentTitle("");
  const [params, setParams] = useSearchParams();
  const side: OfferSide = params.get("seite") === "verkaufen" ? "buy" : "sell";
  const fiat = (FIATS as readonly string[]).includes(params.get("waehrung") ?? "") ? (params.get("waehrung") as Fiat) : "";
  const method = (PAYMENT_METHODS as readonly string[]).includes(params.get("zahlung") ?? "")
    ? (params.get("zahlung") as PaymentMethod)
    : "";
  const amount = params.get("betrag") ?? "";

  const market = useLoad(() => api.market({ side, fiat, method, amount: amount.trim() }), [side, fiat, method, amount]);

  function update(name: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    setParams(next, { replace: true });
  }

  return (
    <>
      <Hero />
      <section className="container section" aria-labelledby="markt-titel">
        <div className="market-head">
          <h2 id="markt-titel">Marktplatz</h2>
          <Link to="/angebot/neu" className="btn btn-secondary">
            <PlusIcon size={16} /> Angebot erstellen
          </Link>
        </div>

        <div className="tabs" role="tablist" aria-label="Handelsrichtung">
          <button
            type="button"
            role="tab"
            aria-selected={side === "sell"}
            className={`tab ${side === "sell" ? "tab-active tab-buy" : ""}`}
            onClick={() => update("seite", "")}
          >
            ADA kaufen
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={side === "buy"}
            className={`tab ${side === "buy" ? "tab-active tab-sell" : ""}`}
            onClick={() => update("seite", "verkaufen")}
          >
            ADA verkaufen
          </button>
        </div>

        <form className="filters" onSubmit={(event) => event.preventDefault()} aria-label="Angebote filtern">
          <label className="field field-inline">
            <span>Währung</span>
            <select value={fiat} onChange={(event) => update("waehrung", event.target.value)}>
              <option value="">Alle</option>
              {FIATS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="field field-inline">
            <span>Zahlungsart</span>
            <select value={method} onChange={(event) => update("zahlung", event.target.value)}>
              <option value="">Alle</option>
              {PAYMENT_METHODS.map((value) => (
                <option key={value} value={value}>
                  {PAYMENT_METHOD_LABEL[value]}
                </option>
              ))}
            </select>
          </label>
          <label className="field field-inline">
            <span>Betrag</span>
            <input
              inputMode="decimal"
              placeholder="z. B. 100"
              defaultValue={amount}
              onBlur={(event) => update("betrag", event.target.value.trim())}
              onKeyDown={(event) => {
                if (event.key === "Enter") update("betrag", event.currentTarget.value.trim());
              }}
            />
          </label>
        </form>

        <p className="muted small market-hint">
          {side === "sell"
            ? "Diese Händler verkaufen ADA. Du zahlst per Überweisung o. Ä. und erhältst die ADA direkt in deine Wallet."
            : "Diese Händler kaufen ADA. Du sendest ADA aus deiner Wallet, sobald ihre Zahlung bei dir eingegangen ist."}
        </p>

        {market.loading && !market.data ? (
          <Spinner label="Angebote werden geladen …" />
        ) : market.error ? (
          <ErrorNotice error={market.error} onRetry={() => void market.reload()} />
        ) : market.data && market.data.offers.length > 0 ? (
          <ul className="offer-list" aria-busy={market.loading}>
            {market.data.offers.map((offer) => (
              <OfferRow key={offer.id} offer={offer} side={side} />
            ))}
          </ul>
        ) : (
          <EmptyState title="Noch keine passenden Angebote">
            <p className="muted">
              {fiat || method || amount ? "Probiere andere Filter oder stelle" : "Stelle"} selbst ein Angebot ein – Händler
              finden dich dann hier.
            </p>
            <Link to="/angebot/neu" className="btn btn-primary">
              <PlusIcon size={16} /> Angebot erstellen
            </Link>
          </EmptyState>
        )}
      </section>
    </>
  );
}
