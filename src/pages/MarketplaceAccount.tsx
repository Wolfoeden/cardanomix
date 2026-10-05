import { Link } from "react-router";
import { LISTING_LABELS, ORDER_LABELS } from "../../shared/marketplace";
import { formatAda } from "../../shared/money";
import { ErrorNotice, Spinner, EmptyState } from "../components/Ui";
import { useLoad } from "../hooks";
import { marketApi } from "../marketplace-api";
export function ListingsTab() {
  const { data, error, loading } = useLoad(() => marketApi.myListings(), []);
  if (error) return <ErrorNotice error={error} />;
  if (loading) return <Spinner />;
  return (
    <div className="stack">
      <Link className="btn btn-secondary" to="/marktplatz/angebot/neu">
        Neues Inserat
      </Link>
      {data?.listings.length ? (
        <ul className="list">
          {data.listings.map((l) => (
            <li key={l.id}>
              <Link className="list-row" to={`/marktplatz/angebot/${l.id}`}>
                <span className="list-main">
                  <strong>{l.title}</strong>
                  <span className="muted small">
                    {formatAda(l.priceLovelace)}
                  </span>
                </span>
                <span className="status">{LISTING_LABELS[l.status]}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="Noch keine Inserate">
          <p>Stelle Waren, digitale Produkte oder Dienstleistungen ein.</p>
        </EmptyState>
      )}
    </div>
  );
}
export function OrdersTab() {
  const { data, error, loading } = useLoad(() => marketApi.myOrders(), []);
  if (error) return <ErrorNotice error={error} />;
  if (loading) return <Spinner />;
  if (!data?.orders.length)
    return (
      <EmptyState title="Noch keine Bestellungen">
        <Link to="/">Angebote entdecken</Link>
      </EmptyState>
    );
  return (
    <ul className="list">
      {data.orders.map((o) => (
        <li key={o.id}>
          <Link className="list-row" to={`/bestellung/${o.id}`}>
            <span className="list-main">
              <strong>{o.title}</strong>
              <span className="muted small">
                {formatAda(
                  o.priceLovelace + o.shippingLovelace + o.feeLovelace,
                )}{" "}
                · {o.buyerName} / {o.sellerName}
              </span>
            </span>
            <span className="status">{ORDER_LABELS[o.status]}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
