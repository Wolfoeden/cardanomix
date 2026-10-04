import { Link, useParams } from "react-router";
import { formatAda, formatFiat, formatPrice } from "../../shared/money";
import { api } from "../api";
import { ThumbDownIcon, ThumbUpIcon } from "../components/Icons";
import { Avatar, EmptyState, ErrorNotice, formatDateTime, formatMonth, Spinner } from "../components/Ui";
import { useDocumentTitle, useLoad } from "../hooks";

export function ProfilePage() {
  const { id = "" } = useParams();
  const { data, error, loading, reload } = useLoad(() => api.user(id), [id]);
  useDocumentTitle(data ? data.user.displayName : "Profil");

  if (loading && !data) return <div className="container section"><Spinner /></div>;
  if (error || !data) {
    return (
      <div className="container section">
        <ErrorNotice error={error ?? new Error("Nutzer nicht gefunden.")} onRetry={() => void reload()} />
      </div>
    );
  }

  const { user, offers, ratings } = data;
  const { stats } = user;
  const rated = stats.positiveRatings + stats.negativeRatings;
  return (
    <div className="container section">
      <header className="profile-head card">
        <Avatar user={user} size={64} />
        <div>
          <h1>{user.displayName}</h1>
          <p className="muted">Dabei seit {formatMonth(user.createdAt)}</p>
        </div>
        <div className="profile-stats">
          <div>
            <strong>{stats.completedTrades}</strong>
            <span>Trades</span>
          </div>
          <div>
            <strong>{stats.completionRate != null ? `${Math.round(stats.completionRate * 100)} %` : "–"}</strong>
            <span>abgeschlossen</span>
          </div>
          <div>
            <strong>{rated > 0 ? `${Math.round((stats.positiveRatings / rated) * 100)} %` : "–"}</strong>
            <span>
              positiv ({stats.positiveRatings}/{rated})
            </span>
          </div>
        </div>
      </header>

      <div className="two-col two-col-even">
        <section className="card">
          <h2>Aktive Angebote</h2>
          {offers.length === 0 ? (
            <p className="muted">Gerade keine aktiven Angebote.</p>
          ) : (
            <ul className="list">
              {offers.map((offer) => (
                <li key={offer.id}>
                  <Link to={`/angebot/${offer.id}`} className="list-row">
                    <span className={`side-pill ${offer.side === "sell" ? "side-sell" : "side-buy"}`}>
                      {offer.side === "sell" ? "Verkauft" : "Kauft"}
                    </span>
                    <span className="list-main">
                      <strong>{offer.priceMicro != null ? formatPrice(offer.priceMicro, offer.fiat) : "–"} pro ADA</strong>
                      <span className="muted small">
                        {formatAda(offer.availableLovelace)} · {formatFiat(offer.minFiatCents, offer.fiat)} –{" "}
                        {formatFiat(offer.effectiveMaxFiatCents ?? offer.maxFiatCents, offer.fiat)}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card">
          <h2>Bewertungen</h2>
          {ratings.length === 0 ? (
            <EmptyState title="Noch keine Bewertungen" />
          ) : (
            <ul className="rating-list">
              {ratings.map((rating, index) => (
                <li key={`${rating.rater.id}-${index}`}>
                  {rating.positive ? <ThumbUpIcon className="up" /> : <ThumbDownIcon className="down" />}
                  <span>
                    <strong>{rating.rater.displayName}</strong>
                    {rating.comment && <>: {rating.comment}</>}
                    <br />
                    <span className="muted small">{formatDateTime(rating.createdAt)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
