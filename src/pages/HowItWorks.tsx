import { Link } from "react-router";
import { NEW_USER_MAX_FIAT_CENTS, NEW_USER_TRADE_THRESHOLD } from "../../shared/constants";
import { formatFiat } from "../../shared/money";
import { ChainIcon, ChatIcon, ClockIcon, ShieldIcon, WalletIcon } from "../components/Icons";
import { useDocumentTitle } from "../hooks";

const buyerSteps = [
  { title: "Angebot wählen", text: "Im Marktplatz unter „ADA kaufen“ ein Angebot mit passendem Preis und passender Zahlungsart auswählen." },
  { title: "Handel starten", text: "Betrag eingeben und starten. Die ADA-Menge wird im Angebot für dich reserviert, die Zahlungsfrist läuft." },
  { title: "Bezahlen", text: "Zahlungsdaten im Chat erhalten, genau den angezeigten Betrag überweisen und „Ich habe bezahlt“ klicken." },
  { title: "ADA erhalten", text: "Der Verkäufer sendet die ADA an deine Wallet. Die Plattform prüft die Transaktion auf der Blockchain." },
];

const sellerSteps = [
  { title: "Angebot erstellen", text: "Preis (fest oder Marktpreis ± %), Menge, Limits und Zahlungsarten festlegen." },
  { title: "Zahlungsdaten teilen", text: "Startet jemand einen Handel, teilst du im Chat, wohin gezahlt werden soll." },
  { title: "Eingang prüfen", text: "Erst wenn das Geld wirklich auf deinem Konto ist, sendest du die ADA an die angezeigte Käuferadresse." },
  { title: "Tx-Hash eintragen", text: "Die Plattform prüft Betrag und Empfänger auf der Blockchain und schließt den Handel ab." },
];

export function HowItWorksPage() {
  useDocumentTitle("So funktioniert’s");
  return (
    <div className="container section">
      <div className="narrow">
        <h1>So funktioniert CardanoMix P2P</h1>
        <p className="lead muted">
          Käufer und Verkäufer handeln direkt miteinander. CardanoMix verwahrt weder ADA noch Geld – die Plattform bringt
          euch zusammen, führt durch den Handel und prüft die ADA-Zahlung auf der Blockchain.
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
              Du meldest dich an, indem du eine Nachricht mit deiner Wallet signierst. Kein Passwort, keine E-Mail – und
              keine Transaktion.
            </p>
          </div>
          <div className="feature">
            <ChainIcon size={22} />
            <h3>Prüfung auf der Blockchain</h3>
            <p className="muted">
              Ein Handel gilt erst als abgeschlossen, wenn die Transaktion bestätigt ist und genug ADA an die Käuferadresse
              gehen – oder der Käufer den Erhalt bestätigt.
            </p>
          </div>
          <div className="feature">
            <ShieldIcon size={22} />
            <h3>Limits &amp; Bewertungen</h3>
            <p className="muted">
              Solange eine Seite weniger als {NEW_USER_TRADE_THRESHOLD} abgeschlossene Trades hat, gilt ein Limit von{" "}
              {formatFiat(NEW_USER_MAX_FIAT_CENTS, "EUR")} pro Handel. Nach jedem Handel bewerten sich beide Seiten.
            </p>
          </div>
          <div className="feature">
            <ClockIcon size={22} />
            <h3>Zahlungsfristen</h3>
            <p className="muted">
              Zahlt der Käufer nicht rechtzeitig, kann der Verkäufer abbrechen; kurz danach bricht das System automatisch
              ab und gibt die Menge wieder frei.
            </p>
          </div>
          <div className="feature">
            <ChatIcon size={22} />
            <h3>Moderation bei Streit</h3>
            <p className="muted">
              Läuft etwas schief, eröffnest du einen Streitfall. Die Moderation sieht den Chat ein, entscheidet und sperrt
              betrügerische Konten.
            </p>
          </div>
        </div>
      </section>

      <section className="card card-muted section-tight">
        <h2>Wichtige Regeln</h2>
        <ul className="tips">
          <li>Zahlungen nur von Konten auf den eigenen Namen. Zahlungen von Dritten sind verboten.</li>
          <li>Keine Kommunikation außerhalb des Handels-Chats – Betrüger versuchen, Gespräche auf Messenger zu verlagern.</li>
          <li>PayPal nur mit „Freunde &amp; Familie“ nach Absprache; Rückbuchungen sind ein bekanntes Betrugsrisiko für Verkäufer.</li>
          <li>Blockchain-Transaktionen sind endgültig. Prüfe Adresse und Betrag vor dem Senden.</li>
        </ul>
        <Link to="/" className="btn btn-primary">
          Zum Marktplatz
        </Link>
      </section>
    </div>
  );
}
