import { Link } from "react-router";
import {
  NEW_USER_MAX_FIAT_CENTS,
  NEW_USER_TRADE_THRESHOLD,
} from "../../shared/constants";
import { formatFiat } from "../../shared/money";
import {
  ChainIcon,
  ChatIcon,
  ClockIcon,
  ShieldIcon,
  WalletIcon,
} from "../components/Icons";
import { useDocumentTitle } from "../hooks";

const buyerSteps = [
  {
    title: "Angebot wählen",
    text: "Im Marktplatz unter „ADA kaufen“ ein Angebot mit passendem Preis und passender Zahlungsart auswählen.",
  },
  {
    title: "Handel starten",
    text: "Betrag eingeben und starten. Die ADA-Menge wird im Angebot für dich reserviert.",
  },
  {
    title: "Auf die Treuhand warten",
    text: "Der Verkäufer legt die ADA in eine Treuhand auf der Blockchain. Erst wenn sie dort liegen, zahlst du.",
  },
  {
    title: "Bezahlen",
    text: "Zahlungsdaten im Chat erhalten, genau den angezeigten Betrag überweisen und „Ich habe bezahlt“ klicken.",
  },
  {
    title: "ADA erhalten",
    text: "Bestätigt der Verkäufer den Eingang, gehen die ADA direkt aus der Treuhand in deine Wallet.",
  },
];

const sellerSteps = [
  {
    title: "Angebot erstellen",
    text: "Preis (fest oder Marktpreis ± %), Menge, Limits und Zahlungsarten festlegen.",
  },
  {
    title: "ADA hinterlegen",
    text: "Startet jemand einen Handel, legst du die ADA per Wallet-Klick in die Treuhand (plus 2 ADA Gebührenpuffer).",
  },
  {
    title: "Zahlungsdaten teilen",
    text: "Im Chat teilst du, wohin gezahlt werden soll.",
  },
  {
    title: "Eingang prüfen",
    text: "Erst wenn das Geld wirklich auf deinem Konto ist, klickst du „Zahlung erhalten – ADA freigeben“.",
  },
  {
    title: "Fertig",
    text: "Die ADA gehen an den Käufer, der Rest des Gebührenpuffers zurück an dich.",
  },
];

export function HowItWorksPage() {
  useDocumentTitle("So funktioniert’s");
  return (
    <div className="container section">
      <div className="narrow">
        <h1>So funktioniert CardanoMix</h1>
        <section className="card stack">
          <h2>Waren, digitale Produkte und Dienstleistungen</h2>
          <p>
            Verbinde deine Wallet, speichere ein kostenloses Inserat, lade
            Bilder hoch und veröffentliche es nach der Vorschau. Kläre offene
            Fragen im privaten Chat.
          </p>
          <p>
            Der Käufer reserviert eine Einheit und prüft vor der Signatur den
            Kaufpreis, Versand, 1 ADA Plattformgebühr und die Netzwerkgebühr.
            Der Kaufpreis mit Versand geht an den Verkäufer. Die Plattformgebühr
            geht an CardanoMix.
          </p>
          <p>
            Zehn Blockchain-Bestätigungen ergeben den Status „Bezahlt“. Nach
            Versand oder Leistung bestätigt der Käufer den Empfang. Eine Zahlung
            beweist keine Lieferung; Rückzahlungen erfordern eine separate
            Signatur des Verkäufers.
          </p>
          <Link to="/">Zum Marktplatz</Link>
        </section>
        <h2>ADA gegen Fiat mit Treuhand</h2>
        <p className="lead muted">
          Käufer und Verkäufer handeln direkt miteinander. Die ADA liegen
          während des Handels in einer Treuhand auf der Blockchain, das Geld
          überweist der Käufer direkt an den Verkäufer. CardanoMix allein kann
          die ADA nie bewegen.
        </p>
      </div>

      <div className="two-col two-col-even">
        <section className="card">
          <h2 className="buy-text">ADA kaufen</h2>
          <ol className="howto">
            {buyerSteps.map((step) => (
              <li key={step.title}>
                <strong>{step.title}</strong>
                <span className="muted">{step.text}</span>
              </li>
            ))}
          </ol>
        </section>
        <section className="card">
          <h2 className="sell-text">ADA verkaufen</h2>
          <ol className="howto">
            {sellerSteps.map((step) => (
              <li key={step.title}>
                <strong>{step.title}</strong>
                <span className="muted">{step.text}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <section className="section-tight">
        <h2>Sicherheit</h2>
        <div className="feature-grid">
          <div className="feature">
            <WalletIcon size={22} />
            <h3>Anmeldung per Signatur</h3>
            <p className="muted">
              Du meldest dich an, indem du eine Nachricht mit deiner Wallet
              signierst. Kein Passwort, keine E-Mail – und keine Transaktion.
            </p>
          </div>
          <div className="feature">
            <ChainIcon size={22} />
            <h3>Treuhand auf der Blockchain</h3>
            <p className="muted">
              Jeder Handel bekommt eine eigene Treuhand-Adresse. Auszahlen geht
              nur mit 2 von 3 Unterschriften – Verkäufer, Käufer, CardanoMix.
              Nach 14 Tagen kann der Verkäufer die ADA auch ohne CardanoMix
              zurückholen.
            </p>
          </div>
          <div className="feature">
            <ShieldIcon size={22} />
            <h3>Limits &amp; Bewertungen</h3>
            <p className="muted">
              Solange eine Seite weniger als {NEW_USER_TRADE_THRESHOLD}{" "}
              abgeschlossene Trades hat, gilt ein Limit von{" "}
              {formatFiat(NEW_USER_MAX_FIAT_CENTS, "EUR")} pro Handel. Nach
              jedem Handel bewerten sich beide Seiten.
            </p>
          </div>
          <div className="feature">
            <ClockIcon size={22} />
            <h3>Zahlungsfristen</h3>
            <p className="muted">
              Zahlt der Käufer nicht rechtzeitig, kann der Verkäufer abbrechen;
              kurz danach bricht das System automatisch ab und gibt die Menge
              wieder frei.
            </p>
          </div>
          <div className="feature">
            <ChatIcon size={22} />
            <h3>Moderation bei Streit</h3>
            <p className="muted">
              Läuft etwas schief, eröffnest du einen Streitfall. Die Moderation
              sieht den Chat ein, entscheidet und sperrt betrügerische Konten.
            </p>
          </div>
        </div>
      </section>

      <section className="section-tight">
        <h2>Was CardanoMix absichert – und was nicht</h2>
        <div className="two-col two-col-even">
          <div className="card">
            <h3 className="buy-text">Abgesichert</h3>
            <ul className="tips">
              <li>
                Der Käufer zahlt erst, wenn die ADA nachweisbar in der Treuhand
                liegen.
              </li>
              <li>
                Freigabe nur mit Signatur des Verkäufers (oder nach Entscheidung
                der Moderation) – CardanoMix allein kann nichts bewegen.
              </li>
              <li>
                Fällt CardanoMix aus, holt der Verkäufer die ADA nach 14 Tagen
                allein zurück.
              </li>
              <li>
                Anmeldung nur mit dem Schlüssel deiner Wallet – ohne Passwort,
                das gestohlen werden kann.
              </li>
            </ul>
          </div>
          <div className="card">
            <h3 className="sell-text">Nicht abgesichert</h3>
            <ul className="tips">
              <li>
                <strong>Die Fiat-Zahlung</strong> sieht die Blockchain nicht. Ob
                das Geld angekommen ist, bestätigt der Verkäufer; im Streitfall
                entscheidet die Moderation anhand der Belege.
              </li>
              <li>Rückbuchungen von Banküberweisungen trägt der Verkäufer.</li>
              <li>
                Im Streitfall vertraust du der Entscheidung der Moderation; sie
                signiert die Auszahlung mit.
              </li>
              <li>
                Eine Wallet beweist Kontrolle über einen Schlüssel, nicht die
                Identität einer Person.
              </li>
            </ul>
          </div>
        </div>
      </section>

      <section className="card card-muted section-tight">
        <h2>Wichtige Regeln</h2>
        <ul className="tips">
          <li>
            Zahlungen nur von Konten auf den eigenen Namen. Zahlungen von
            Dritten sind verboten.
          </li>
          <li>
            Keine Kommunikation außerhalb des Handels-Chats – Betrüger
            versuchen, Gespräche auf Messenger zu verlagern.
          </li>
          <li>
            Verkäufer: Banküberweisungen lassen sich in Einzelfällen
            zurückholen. Sende ADA erst, wenn das Geld auf deinem Konto
            gutgeschrieben ist, und handle anfangs nur kleine Beträge.
          </li>
          <li>
            Blockchain-Transaktionen sind endgültig. Prüfe Adresse und Betrag
            vor dem Senden.
          </li>
        </ul>
        <Link to="/" className="btn btn-primary">
          Zum Marktplatz
        </Link>
      </section>
    </div>
  );
}
