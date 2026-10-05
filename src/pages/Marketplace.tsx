import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  TYPE_LABELS,
  LISTING_LABELS,
  type Listing,
} from "../../shared/marketplace";
import { formatAda } from "../../shared/money";
import { ErrorNotice, Spinner, EmptyState } from "../components/Ui";
import { useDocumentTitle, useLoad } from "../hooks";
import { marketApi } from "../marketplace-api";

export function ListingCard({ listing }: { listing: Listing }) {
  return (
    <article className="listing-card">
      <Link
        to={`/marktplatz/angebot/${listing.id}`}
        className="listing-photo"
        aria-label={listing.title}
      >
        {listing.images[0] ? (
          <img
            src={listing.images[0].thumbnailUrl}
            alt={listing.title}
            loading="lazy"
            width="640"
            height="480"
          />
        ) : (
          <span className="listing-placeholder" aria-hidden="true">
            {TYPE_LABELS[listing.type]}
            <span>Ohne Bild</span>
          </span>
        )}
        <span className="listing-type">{TYPE_LABELS[listing.type]}</span>
      </Link>
      <div className="listing-card-body">
        <span className="small muted">
          {CATEGORY_LABELS[listing.category]}
          {listing.location ? ` · ${listing.location}` : ""}
        </span>
        <h2>
          <Link to={`/marktplatz/angebot/${listing.id}`}>{listing.title}</Link>
        </h2>
        <div className="listing-card-bottom">
          <strong>{formatAda(listing.priceLovelace)}</strong>
          <span className="small muted">{LISTING_LABELS[listing.status]}</span>
        </div>
        <span className="small muted">{listing.sellerName}</span>
      </div>
    </article>
  );
}
export function MarketplacePage() {
  useDocumentTitle("Marktplatz für Waren, Digitales & Dienstleistungen");
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const { data, error, loading, reload } = useLoad(
    () => marketApi.listings(params),
    [params.toString()],
  );
  const change = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    next.delete("offset");
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  };
  return (
    <div className="container section marketplace">
      <section className="market-intro">
        <div>
          <span className="market-eyebrow">Der Marktplatz mit Cardano</span>
          <h1>
            Dein nächster Fund.
            <br />
            <span>Bezahlt in ADA.</span>
          </h1>
          <p>
            Waren, digitale Produkte und Dienstleistungen direkt von anderen
            Menschen kaufen. Mit Wallet, Bildern und einem persönlichen
            Gespräch.
          </p>
        </div>
        <div className="market-start">
          <span className="market-fee">Kostenlos inserieren</span>
          <Link className="btn btn-primary" to="/marktplatz/angebot/neu">
            Angebot erstellen
          </Link>
          <small>
            Beim Kauf: 1 ADA Plattformgebühr.
            <br />
            Netzwerkgebühr zusätzlich.
          </small>
          <Link to="/ada-handeln" className="small">
            Du möchtest ADA kaufen oder verkaufen? →
          </Link>
        </div>
      </section>
      <form
        className="market-search"
        onSubmit={(e) => {
          e.preventDefault();
          change("q", query);
        }}
      >
        <label className="field">
          <span>Was suchst du?</span>
          <input
            type="search"
            placeholder="Zum Beispiel Kamera, Design oder Sammlerstück"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            maxLength={120}
          />
        </label>
        <button className="btn btn-primary" type="submit">
          Suchen
        </button>
      </form>
      <nav className="category-strip" aria-label="Kategorien">
        <button
          type="button"
          className={!params.get("category") ? "selected" : ""}
          onClick={() => change("category", "")}
        >
          Alles entdecken
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            className={params.get("category") === c ? "selected" : ""}
            onClick={() => change("category", c)}
          >
            {CATEGORY_LABELS[c]}
          </button>
        ))}
      </nav>
      <div className="market-filterbar">
        <label className="field">
          <span>Angebotstyp</span>
          <select
            value={params.get("type") ?? ""}
            onChange={(e) => change("type", e.target.value)}
          >
            <option value="">Alle Angebote</option>
            {Object.entries(TYPE_LABELS).map(([key, label]) => (
              <option value={key} key={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Preis ab (ADA)</span>
          <input
            inputMode="decimal"
            value={params.get("min") ?? ""}
            onChange={(e) => change("min", e.target.value)}
            placeholder="0"
          />
        </label>
        <label className="field">
          <span>Preis bis (ADA)</span>
          <input
            inputMode="decimal"
            value={params.get("max") ?? ""}
            onChange={(e) => change("max", e.target.value)}
            placeholder="Beliebig"
          />
        </label>
        <label className="field">
          <span>Sortierung</span>
          <select
            value={params.get("sort") ?? "newest"}
            onChange={(e) => change("sort", e.target.value)}
          >
            <option value="newest">Neueste zuerst</option>
            <option value="price_asc">Preis aufsteigend</option>
            <option value="price_desc">Preis absteigend</option>
          </select>
        </label>
      </div>
      <div className="market-results-heading">
        <h2>
          {params.get("category")
            ? CATEGORY_LABELS[params.get("category")!]
            : "Entdecke die Angebote"}
        </h2>
        <span className="small muted">
          Eine Wallet brauchst du erst beim Kontakt oder Kauf.
        </span>
      </div>
      {error ? (
        <ErrorNotice error={error} onRetry={() => void reload()} />
      ) : loading && !data ? (
        <Spinner />
      ) : !data?.listings.length ? (
        <EmptyState title="Noch keine passenden Angebote">
          <p>Stelle das erste Angebot ein oder ändere deine Suche.</p>
          <Link className="btn btn-secondary" to="/marktplatz/angebot/neu">
            Kostenlos inserieren
          </Link>
        </EmptyState>
      ) : (
        <div className="listing-grid">
          {data.listings.map((listing) => (
            <ListingCard key={listing.id} listing={listing} />
          ))}
        </div>
      )}
      <div className="form-actions">
        <button
          className="btn btn-ghost"
          disabled={!Number(params.get("offset"))}
          onClick={() =>
            change(
              "offset",
              String(Math.max(0, Number(params.get("offset") ?? 0) - 25)),
            )
          }
        >
          Zurück
        </button>
        <button
          className="btn btn-ghost"
          disabled={data?.listings.length !== 25}
          onClick={() =>
            change("offset", String(Number(params.get("offset") ?? 0) + 25))
          }
        >
          Weitere Angebote
        </button>
      </div>
      <aside className="market-trust">
        <strong>Du siehst, wohin dein ADA geht.</strong>
        <p>
          Kaufpreis direkt an den Anbieter, 1 ADA an CardanoMix – gemeinsam in
          einer Transaktion. Lieferung und Leistung vereinbarst du mit dem
          Anbieter.
        </p>
      </aside>
    </div>
  );
}
