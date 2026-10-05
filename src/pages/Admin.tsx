import { Link } from "react-router";
import { formatAda, formatFiat } from "../../shared/money";
import { api } from "../api";
import { useAuth } from "../auth";
import { EmptyState, ErrorNotice, formatDateTime, Spinner } from "../components/Ui";
import { useDocumentTitle, useLoad } from "../hooks";
import { MarketplaceAdmin } from "./MarketplaceAdmin";

function Disputes() {
  const { data, error, loading, reload } = useLoad(() => api.disputes(), []);
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorNotice error={error} onRetry={() => void reload()} />;
  if (!data || data.disputes.length === 0) return <EmptyState title="Keine offenen Streitfälle" />;
  return (
    <ul className="list">
      {data.disputes.map((dispute) => (
        <li key={dispute.id}>
          <Link to={`/handel/${dispute.id}`} className="list-row">
            <span className="list-main">
              <strong>
                {formatAda(dispute.lovelace)} · {formatFiat(dispute.fiatCents, dispute.fiat)}
              </strong>
              <span className="muted small">
                Käufer {dispute.buyer.displayName} · Verkäufer {dispute.seller.displayName}
                {dispute.disputedAt && <> · seit {formatDateTime(dispute.disputedAt)}</>}
              </span>
              {dispute.disputeReason && <span className="small">„{dispute.disputeReason}“</span>}
            </span>
            <span className="status status-disputed">Prüfen</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function AdminPage() {
  useDocumentTitle("Moderation");
  const { me, ready } = useAuth();
  if (!ready) return <div className="container section"><Spinner /></div>;
  return (
    <div className="container section">
      <h1>Moderation</h1>
      {me?.isAdmin ? (
        <>
          <p className="muted">Offene Streitfälle. Öffne einen Handel, um Chat und Details zu sehen und zu entscheiden.</p>
          <Disputes />
          <MarketplaceAdmin />
        </>
      ) : (
        <div className="notice notice-warn">Dieser Bereich ist nur für Moderatoren.</div>
      )}
    </div>
  );
}
