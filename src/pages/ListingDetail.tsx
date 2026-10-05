import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  CATEGORY_LABELS,
  TYPE_LABELS,
  LISTING_LABELS,
} from "../../shared/marketplace";
import { formatAda } from "../../shared/money";
import { errorMessage } from "../api";
import { useAuth } from "../auth";
import { ErrorNotice, Spinner } from "../components/Ui";
import { useDocumentTitle, useLoad, useInterval } from "../hooks";
import { marketApi } from "../marketplace-api";
export function ListingDetailPage() {
  const { id } = useParams(),
    navigate = useNavigate(),
    { me, requireLogin } = useAuth();
  const { data, error, loading, reload } = useLoad(
    () => marketApi.listing(id!),
    [id, me?.id],
  );
  const [selected, setSelected] = useState(0),
    [details, setDetails] = useState(""),
    [busy, setBusy] = useState(false),
    [actionError, setActionError] = useState<string | null>(null),
    [reporting, setReporting] = useState(false),
    [reason, setReason] = useState(""),
    [reported, setReported] = useState(false);
  useDocumentTitle(data?.listing.title ?? "Angebot");
  useInterval(() => void reload(), 240000);
  async function action(fn: () => Promise<void>) {
    setBusy(true);
    setActionError(null);
    try {
      await requireLogin();
      await fn();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  if (error)
    return (
      <div className="container section">
        <ErrorNotice error={error} />
      </div>
    );
  if (loading && !data) return <Spinner />;
  if (!data) return null;
  const l = data.listing,
    owner = me?.id === l.sellerId;
  return (
    <div className="container section">
      <Link to="/">← Alle Angebote</Link>
      <div className="listing-detail-grid">
        <section>
          <div className="listing-gallery">
            {l.images.length ? (
              <img
                src={(l.images[selected] ?? l.images[0]).url}
                alt={l.title}
              />
            ) : (
              <div className="listing-placeholder">
                {TYPE_LABELS[l.type]}
                <span>Dieses Angebot hat noch kein Bild.</span>
              </div>
            )}
          </div>
          {l.images.length > 1 && (
            <div className="gallery-thumbs">
              {l.images.map((image, i) => (
                <button
                  key={image.id}
                  type="button"
                  onClick={() => setSelected(i)}
                  aria-label={`Bild ${i + 1} anzeigen`}
                  aria-pressed={selected === i}
                >
                  <img src={image.thumbnailUrl} alt="" />
                </button>
              ))}
            </div>
          )}
          <section className="card stack">
            <h2>Beschreibung</h2>
            <p className="preserve-lines">{l.description}</p>
            {l.serviceScope && (
              <>
                <h3>Leistungsumfang</h3>
                <p className="preserve-lines">{l.serviceScope}</p>
              </>
            )}
            {l.terms && (
              <>
                <h3>Lieferbedingungen</h3>
                <p className="preserve-lines">{l.terms}</p>
              </>
            )}
          </section>
        </section>
        <section className="stack">
          <span className="market-eyebrow">
            {CATEGORY_LABELS[l.category]} · {TYPE_LABELS[l.type]}
          </span>
          <h1>{l.title}</h1>
          <span className="status">{LISTING_LABELS[l.status]}</span>
          <div className="listing-detail-price">
            {formatAda(l.priceLovelace)}
          </div>
          <dl className="facts">
            <div>
              <dt>Versand</dt>
              <dd>
                {l.delivery === "shipping"
                  ? formatAda(l.shippingLovelace)
                  : l.delivery === "pickup"
                    ? "Abholung"
                    : "Digitale Lieferung / Leistung"}
              </dd>
            </div>
            <div>
              <dt>Lieferzeit</dt>
              <dd>{l.deliveryDays} Tage</dd>
            </div>
            {l.condition && (
              <div>
                <dt>Zustand</dt>
                <dd>{l.condition}</dd>
              </div>
            )}
            {l.location && (
              <div>
                <dt>Ort</dt>
                <dd>{l.location}</dd>
              </div>
            )}
            <div>
              <dt>Anbieter</dt>
              <dd>
                <Link to={`/nutzer/${l.sellerId}`}>{l.sellerName}</Link>
              </dd>
            </div>
          </dl>
          {owner ? (
            <div className="card stack">
              <h2>Dein Angebot</h2>
              <Link
                className="btn btn-secondary"
                to={`/marktplatz/angebot/${l.id}/bearbeiten`}
              >
                Bearbeiten & Bilder
              </Link>
              {["draft", "paused"].includes(l.status) && (
                <button
                  disabled={busy}
                  className="btn btn-primary"
                  onClick={() =>
                    void action(async () => {
                      await marketApi.status(l.id, "active");
                      await reload();
                    })
                  }
                >
                  Veröffentlichen
                </button>
              )}
              {l.status === "active" && (
                <button
                  disabled={busy}
                  className="btn btn-ghost"
                  onClick={() =>
                    void action(async () => {
                      await marketApi.status(l.id, "paused");
                      await reload();
                    })
                  }
                >
                  Pausieren
                </button>
              )}
              {["draft", "active", "paused"].includes(l.status) && (
                <button
                  disabled={busy}
                  className="btn btn-ghost"
                  onClick={() =>
                    void action(async () => {
                      await marketApi.status(l.id, "archived");
                      await reload();
                    })
                  }
                >
                  Archivieren
                </button>
              )}
              <button
                disabled={busy}
                className="btn btn-ghost"
                onClick={() =>
                  void action(async () => {
                    const next = await marketApi.duplicate(l.id);
                    navigate(
                      `/marktplatz/angebot/${next.listing.id}/bearbeiten`,
                    );
                  })
                }
              >
                Als neues Angebot duplizieren
              </button>
            </div>
          ) : (
            <div className="card stack">
              <h2>Direkt beim Anbieter kaufen</h2>
              <p className="small muted">
                Gesamt: {formatAda(l.priceLovelace + l.shippingLovelace + 1e6)}{" "}
                plus Netzwerkgebühr. Enthält 1 ADA Plattformgebühr.
              </p>
              {l.delivery === "shipping" && (
                <label className="field">
                  <span>Lieferdaten (nur für die Bestellparteien)</span>
                  <textarea
                    maxLength={1500}
                    rows={4}
                    value={details}
                    onChange={(e) => setDetails(e.target.value)}
                    placeholder="Name, Straße, PLZ, Ort und Land"
                  />
                </label>
              )}
              <button
                disabled={busy || l.status !== "active"}
                className="btn btn-primary"
                onClick={() =>
                  void action(async () => {
                    const { order } = await marketApi.buy(l.id, details);
                    navigate(`/bestellung/${order.id}`);
                  })
                }
              >
                Verbindlich bestellen
              </button>
              <button
                className="btn btn-secondary"
                disabled={busy}
                onClick={() =>
                  void action(async () => {
                    const { conversationId } = await marketApi.contact(l.id);
                    navigate(`/nachrichten/${conversationId}`);
                  })
                }
              >
                Anbieter kontaktieren
              </button>
              <p className="small muted">
                Du prüfst die Zahlung in deiner Wallet, bevor du signierst. Die
                direkte Zahlung bietet keine Treuhand für die Lieferung.
              </p>
            </div>
          )}
          {actionError && <ErrorNotice error={new Error(actionError)} />}
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setReporting((v) => !v)}
          >
            Angebot melden
          </button>
          {reporting && (
            <form
              className="card stack"
              onSubmit={(e) => {
                e.preventDefault();
                void action(async () => {
                  await marketApi.report(l.id, reason);
                  setReported(true);
                  setReporting(false);
                });
              }}
            >
              <label className="field">
                <span>Grund der Meldung</span>
                <textarea
                  required
                  minLength={5}
                  maxLength={2000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <button className="btn btn-secondary" disabled={busy}>
                Meldung absenden
              </button>
            </form>
          )}
          {reported && (
            <p role="status">Deine Meldung wird von der Moderation geprüft.</p>
          )}
        </section>
      </div>
    </div>
  );
}
