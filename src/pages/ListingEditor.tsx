import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  TYPE_LABELS,
  LISTING_LABELS,
  type Listing,
  type ListingInput,
} from "../../shared/marketplace";
import { errorMessage } from "../api";
import { useAuth } from "../auth";
import { EmptyState, ErrorNotice, Spinner } from "../components/Ui";
import { useDocumentTitle, useLoad } from "../hooks";
import { marketApi } from "../marketplace-api";
const blank: ListingInput = {
  title: "",
  description: "",
  category: "other",
  type: "goods",
  priceAda: "",
  shippingAda: "0",
  delivery: "shipping",
  condition: "Gebraucht",
  location: "",
  terms: "",
  serviceScope: "",
  deliveryDays: 7,
};
function inputFor(l: Listing): ListingInput {
  return {
    title: l.title,
    description: l.description,
    category: l.category as ListingInput["category"],
    type: l.type as ListingInput["type"],
    priceAda: String(l.priceLovelace / 1e6),
    shippingAda: String(l.shippingLovelace / 1e6),
    delivery: l.delivery as ListingInput["delivery"],
    condition: l.condition,
    location: l.location,
    terms: l.terms,
    serviceScope: l.serviceScope,
    deliveryDays: l.deliveryDays,
  };
}
function Editor({ initial }: { initial?: Listing }) {
  const { requireLogin } = useAuth(),
    navigate = useNavigate();
  const [listing, setListing] = useState(initial),
    [input, setInput] = useState<ListingInput>(
      initial ? inputFor(initial) : blank,
    ),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [saved, setSaved] = useState(false);
  const field = <K extends keyof ListingInput>(
    key: K,
    value: ListingInput[K],
  ) => {
    setInput((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };
  async function save() {
    await requireLogin();
    const { listing: next } = await marketApi.save(input, listing?.id);
    setListing(next);
    setSaved(true);
    return next;
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await save();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const selectedFiles = Array.from(files);
    setBusy(true);
    setError(null);
    try {
      const draft = await save();
      for (const file of selectedFiles) {
        let imageId: string | undefined;
        try {
          const prepared = await marketApi.upload(draft.id, file);
          imageId = prepared.imageId;
          const response = await fetch(prepared.uploadUrl, {
            method: "PUT",
            headers: { "content-type": file.type },
            body: file,
          });
          if (!response.ok)
            throw new Error("Bild konnte nicht hochgeladen werden.");
          await marketApi.imageReady(draft.id, imageId);
        } catch (err) {
          if (imageId)
            await marketApi
              .deleteImage(draft.id, imageId)
              .catch(() => undefined);
          throw err;
        }
      }
      setListing((await marketApi.listing(draft.id)).listing);
    } catch (err) {
      setError(errorMessage(err));
      if (listing) setListing((await marketApi.listing(listing.id)).listing);
    } finally {
      setBusy(false);
    }
  }
  const editable =
    !listing || ["draft", "active", "paused"].includes(listing.status);
  return (
    <div className="container section narrow">
      <Link to="/">← Zum Marktplatz</Link>
      <h1>{listing ? "Angebot bearbeiten" : "Dein Angebot einstellen"}</h1>
      <p className="muted">
        Kostenlos inserieren. Käufer bezahlen den Festpreis plus 1 ADA
        Plattformgebühr.
      </p>
      {listing && <p className="status">{LISTING_LABELS[listing.status]}</p>}
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <fieldset className="card stack" disabled={busy || !editable}>
          <legend>Angebot</legend>
          <label className="field">
            <span>Titel</span>
            <input
              required
              minLength={3}
              maxLength={120}
              value={input.title}
              onChange={(e) => field("title", e.target.value)}
              placeholder="Was bietest du an?"
            />
          </label>
          <div className="market-two">
            <label className="field">
              <span>Angebotstyp</span>
              <select
                value={input.type}
                onChange={(e) => {
                  const type = e.target.value as ListingInput["type"];
                  setInput((prev) => ({
                    ...prev,
                    type,
                    delivery: type === "goods" ? "shipping" : "digital",
                    shippingAda: "0",
                  }));
                }}
              >
                {Object.entries(TYPE_LABELS).map(([k, v]) => (
                  <option value={k} key={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Kategorie</span>
              <select
                value={input.category}
                onChange={(e) =>
                  field("category", e.target.value as ListingInput["category"])
                }
              >
                {CATEGORIES.map((c) => (
                  <option value={c} key={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="field">
            <span>Beschreibung</span>
            <textarea
              required
              minLength={10}
              maxLength={10000}
              rows={7}
              value={input.description}
              onChange={(e) => field("description", e.target.value)}
              placeholder="Beschreibe dein Angebot, den Zustand und was enthalten ist."
            />
          </label>
          <label className="field">
            <span>Festpreis in ADA</span>
            <input
              required
              inputMode="decimal"
              value={input.priceAda}
              onChange={(e) => field("priceAda", e.target.value)}
              placeholder="Mindestens 2 ADA"
            />
          </label>
          {input.type === "goods" && (
            <div className="market-two">
              <label className="field">
                <span>Zustand</span>
                <select
                  value={input.condition}
                  onChange={(e) => field("condition", e.target.value)}
                >
                  <option>Neu</option>
                  <option>Wie neu</option>
                  <option>Gebraucht</option>
                  <option>Defekt / Ersatzteile</option>
                </select>
              </label>
              <label className="field">
                <span>Ort (öffentlich, optional)</span>
                <input
                  maxLength={100}
                  value={input.location}
                  onChange={(e) => field("location", e.target.value)}
                  placeholder="Stadt oder Region"
                />
              </label>
            </div>
          )}
          {input.type === "service" && (
            <label className="field">
              <span>Leistungsumfang</span>
              <textarea
                required
                minLength={10}
                rows={3}
                value={input.serviceScope}
                onChange={(e) => field("serviceScope", e.target.value)}
                placeholder="Was ist im Festpreis enthalten?"
              />
            </label>
          )}
          <div className="market-two">
            <label className="field">
              <span>Lieferung</span>
              <select
                value={input.delivery}
                onChange={(e) => {
                  field("delivery", e.target.value as ListingInput["delivery"]);
                  if (e.target.value !== "shipping") field("shippingAda", "0");
                }}
              >
                {input.type === "goods" ? (
                  <>
                    <option value="shipping">Versand</option>
                    <option value="pickup">Abholung</option>
                  </>
                ) : (
                  <option value="digital">Digitale Lieferung / Leistung</option>
                )}
              </select>
            </label>
            {input.delivery === "shipping" && (
              <label className="field">
                <span>Versandkosten in ADA</span>
                <input
                  inputMode="decimal"
                  required
                  value={input.shippingAda}
                  onChange={(e) => field("shippingAda", e.target.value)}
                />
              </label>
            )}
            <label className="field">
              <span>Lieferzeit in Tagen</span>
              <input
                type="number"
                min={0}
                max={365}
                required
                value={input.deliveryDays}
                onChange={(e) => field("deliveryDays", Number(e.target.value))}
              />
            </label>
          </div>
          <label className="field">
            <span>Lieferbedingungen</span>
            <textarea
              rows={3}
              maxLength={3000}
              value={input.terms}
              onChange={(e) => field("terms", e.target.value)}
              placeholder="Versandgebiet, Abholung oder Ablauf der Leistung"
            />
          </label>
          <button type="submit" className="btn btn-secondary">
            {listing ? "Änderungen speichern" : "Entwurf speichern"}
          </button>
        </fieldset>
        <section className="card stack">
          <h2>Bilder</h2>
          <p className="muted small">
            Bis zu zehn Bilder, je maximal 5 MiB. JPEG, PNG oder WebP. Fülle
            zuerst die Angebotsdaten aus.
          </p>
          <label className="field">
            <span>Bilder hinzufügen</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              disabled={busy || !editable}
              onChange={(e) => {
                void upload(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          <div className="image-edit-grid">
            {listing?.images.map((image) => (
              <div key={image.id}>
                <img src={image.thumbnailUrl} alt={input.title} />
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={busy || !editable}
                  type="button"
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await marketApi.deleteImage(listing.id, image.id);
                      setListing((await marketApi.listing(listing.id)).listing);
                    } catch (err) {
                      setError(errorMessage(err));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Bild entfernen
                </button>
              </div>
            ))}
          </div>
        </section>
        {error && <ErrorNotice error={new Error(error)} />}
        <div aria-live="polite">
          {busy
            ? "Wird gespeichert …"
            : saved
              ? "Gespeichert. Dein Angebot ist bereit für die Vorschau."
              : ""}
        </div>
        {listing && (
          <div className="form-actions">
            <Link
              className="btn btn-secondary"
              to={`/marktplatz/angebot/${listing.id}`}
            >
              Vorschau ansehen
            </Link>
            {editable && listing.status !== "active" && (
              <button
                className="btn btn-primary"
                disabled={busy}
                type="button"
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    const next = await save();
                    await marketApi.status(next.id, "active");
                    navigate(`/marktplatz/angebot/${next.id}`);
                  } catch (err) {
                    setError(errorMessage(err));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Angebot veröffentlichen
              </button>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
function ExistingEditor({ id }: { id: string }) {
  const { data, error, loading } = useLoad(() => marketApi.listing(id), [id]);
  if (error)
    return (
      <div className="container section">
        <ErrorNotice error={error} />
      </div>
    );
  if (loading || !data) return <Spinner />;
  return <Editor initial={data.listing} key={id} />;
}
export function ListingEditorPage() {
  useDocumentTitle("Angebot erstellen");
  const { id } = useParams();
  const { me, ready, requireLogin } = useAuth();
  if (!ready) return <Spinner />;
  if (!me)
    return (
      <div className="container section">
        <EmptyState title="Mit Wallet anmelden">
          <p>Du brauchst eine Wallet, um Angebote einzustellen.</p>
          <button
            className="btn btn-primary"
            onClick={() => void requireLogin().catch(() => undefined)}
          >
            Mit Wallet anmelden
          </button>
        </EmptyState>
      </div>
    );
  return id ? <ExistingEditor id={id} /> : <Editor />;
}
