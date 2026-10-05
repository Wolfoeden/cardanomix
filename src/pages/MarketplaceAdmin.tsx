import { useState } from "react";
import { Link } from "react-router";
import { errorMessage } from "../api";
import { ErrorNotice, EmptyState } from "../components/Ui";
import { useLoad } from "../hooks";
import { marketApi } from "../marketplace-api";
export function MarketplaceAdmin() {
  const reports = useLoad(() => marketApi.reports(), []),
    orders = useLoad(() => marketApi.disputedOrders(), []);
  const [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [notes, setNotes] = useState<Record<string, string>>({});
  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await reports.reload();
      await orders.reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stack">
      <h2>Gemeldete Inserate</h2>
      {Boolean(reports.error) && <ErrorNotice error={reports.error} />}{" "}
      {!reports.loading && !reports.data?.reports.length && (
        <EmptyState title="Keine offenen Meldungen" />
      )}
      {reports.data?.reports.map((r) => (
        <article key={r.id} className="card stack">
          <h3>{r.title}</h3>
          <p>{r.reason}</p>
          <Link to={`/marktplatz/angebot/${r.listingId}`}>Angebot ansehen</Link>
          <div className="form-actions">
            <button
              disabled={busy}
              className="btn btn-secondary"
              onClick={() => void act(() => marketApi.moderate(r.id, "hide"))}
            >
              Angebot ausblenden
            </button>
            <button
              disabled={busy}
              className="btn btn-ghost"
              onClick={() =>
                void act(() => marketApi.moderate(r.id, "resolve"))
              }
            >
              Meldung schließen
            </button>
            <button
              disabled={busy}
              className="btn btn-ghost btn-danger-text"
              onClick={() => void act(() => marketApi.moderate(r.id, "ban"))}
            >
              Anbieter sperren
            </button>
          </div>
        </article>
      ))}
      <h2>Streitfälle im Marktplatz</h2>
      {Boolean(orders.error) && <ErrorNotice error={orders.error} />}{" "}
      {!orders.loading && !orders.data?.orders.length && (
        <p className="muted">Keine offenen Marktplatz-Streitfälle.</p>
      )}
      {orders.data?.orders.map((o) => (
        <article className="card stack" key={o.id}>
          <h3>{o.title}</h3>
          <p>{o.dispute_reason}</p>
          <label className="field">
            <span>Entscheidung und vereinbarte Lösung</span>
            <textarea
              value={notes[o.id] ?? ""}
              onChange={(e) =>
                setNotes((v) => ({ ...v, [o.id]: e.target.value }))
              }
              minLength={5}
            />
          </label>
          <p className="small muted">
            Eine Entscheidung löst keine automatische Rückzahlung aus. Verkäufer
            und Käufer müssen eine Rückzahlung separat vereinbaren.
          </p>
          <button
            className="btn btn-secondary"
            disabled={busy || (notes[o.id] ?? "").length < 5}
            onClick={() =>
              void act(() => marketApi.resolveOrder(o.id, notes[o.id]))
            }
          >
            Mit Entscheidung schließen
          </button>
        </article>
      ))}
      {error && <ErrorNotice error={new Error(error)} />}
    </div>
  );
}
