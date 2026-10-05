import { useState } from "react";
import { Link, useParams } from "react-router";
import { errorMessage } from "../api";
import { useAuth } from "../auth";
import {
  EmptyState,
  ErrorNotice,
  Spinner,
  formatDateTime,
} from "../components/Ui";
import { useLoad, useInterval, useDocumentTitle } from "../hooks";
import { marketApi } from "../marketplace-api";
export function ConversationChat({ id }: { id: string }) {
  const { me } = useAuth();
  const { data, error, reload } = useLoad(() => marketApi.messages(id), [id]);
  const [body, setBody] = useState(""),
    [busy, setBusy] = useState(false),
    [sendError, setSendError] = useState<string | null>(null);
  useInterval(() => void reload(), 5000);
  return (
    <section className="card stack">
      <h2>Privater Chat</h2>
      {Boolean(error) && <ErrorNotice error={error} />}
      <div className="market-messages" aria-live="polite">
        {data?.messages.length ? (
          data.messages.map((m) => (
            <div
              className={`market-message ${m.senderId === me?.id ? "own" : ""}`}
              key={m.id}
            >
              <strong className="small">
                {m.senderId === me?.id ? "Du" : "Handelspartner"}
              </strong>
              <p className="preserve-lines">{m.body}</p>
              <small className="muted">{formatDateTime(m.createdAt)}</small>
            </div>
          ))
        ) : (
          <p className="muted">
            Noch keine Nachrichten. Klärt hier Lieferung und offene Fragen.
          </p>
        )}
      </div>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setSendError(null);
          try {
            await marketApi.send(id, body);
            setBody("");
            await reload();
          } catch (err) {
            setSendError(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          <span>Nachricht</span>
          <textarea
            required
            maxLength={2000}
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </label>
        {sendError && <ErrorNotice error={new Error(sendError)} />}
        <button className="btn btn-primary" disabled={busy || !body.trim()}>
          Senden
        </button>
      </form>
    </section>
  );
}
export function MessagesTab() {
  const { data, error, loading } = useLoad(() => marketApi.conversations(), []);
  if (error) return <ErrorNotice error={error} />;
  if (loading) return <Spinner />;
  if (!data?.conversations.length)
    return (
      <EmptyState title="Noch keine Unterhaltungen">
        <p>Kontaktiere einen Anbieter über sein Angebot.</p>
      </EmptyState>
    );
  return (
    <ul className="list">
      {data.conversations.map((c) => (
        <li key={c.id}>
          <Link className="list-row" to={`/nachrichten/${c.id}`}>
            <span>
              <strong>{c.title}</strong>
              <span className="muted small">
                {c.buyerName} · {c.sellerName}
              </span>
            </span>
            <span className="muted small">{formatDateTime(c.updatedAt)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
export function MessagesPage() {
  const { id } = useParams(),
    { me, ready, requireLogin } = useAuth();
  useDocumentTitle("Nachrichten");
  if (!ready) return <Spinner />;
  return (
    <div className="container section narrow">
      <Link to="/konto?tab=nachrichten">← Alle Nachrichten</Link>
      <h1>Nachrichten</h1>
      {me ? (
        <ConversationChat id={id!} />
      ) : (
        <button
          className="btn btn-primary"
          onClick={() => void requireLogin().catch(() => undefined)}
        >
          Mit Wallet anmelden
        </button>
      )}
    </div>
  );
}
