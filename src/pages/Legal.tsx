import { useEffect } from "react";
import { useLocation } from "react-router";
import { NEW_USER_MAX_FIAT_CENTS } from "../../shared/constants";
import { formatFiat } from "../../shared/money";
import { useDocumentTitle } from "../hooks";
import { operator, operatorComplete } from "../legal";

function Operator() {
  if (!operatorComplete) {
    return <p className="notice notice-warn">Die Angaben zum Betreiber werden derzeit ergänzt.</p>;
  }
  return (
    <address>
      {operator.name}
      <br />
      {operator.street}
      <br />
      {operator.city}
      <br />
      E-Mail: <a href={`mailto:${operator.email}`}>{operator.email}</a>
      {operator.phone && (
        <>
          <br />
          Telefon: {operator.phone}
        </>
      )}
      {operator.register && (
        <>
          <br />
          {operator.register}
        </>
      )}
    </address>
  );
}

export function LegalPage() {
  useDocumentTitle("Rechtliches");
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView();
  }, [hash]);

  return (
    <div className="container section narrow prose">
      <h1>Rechtliches</h1>

      <section id="risiken">
        <h2>Risikohinweis</h2>
        <ul>
          <li>Der Kurs von ADA schwankt stark. Ein Totalverlust ist möglich.</li>
          <li>
            Die ADA liegen während eines Handels auf einer Treuhand-Adresse (Native Script). Auszahlen geht nur mit zwei von drei
            Unterschriften (Verkäufer, Käufer, CardanoMix); nach 14 Tagen kann der Verkäufer allein zurückholen. CardanoMix allein
            kann die ADA nicht bewegen. Fiat-Zahlungen laufen direkt zwischen den Handelspartnern und werden nicht verwahrt.
          </li>
          <li>
            Ob die Fiat-Zahlung angekommen ist, kann die Blockchain nicht sehen. Im Streitfall entscheidet die Moderation anhand
            der Belege und signiert die Auszahlung an die berechtigte Seite mit.
          </li>
          <li>Die Treuhand ist neu (Beta). Nicht alle Wallets unterstützen das Mitsignieren gleich gut; starte mit kleinen Beträgen.</li>
          <li>Banküberweisungen und besonders PayPal-Zahlungen können zurückgebucht werden.</li>
          <li>Transaktionen auf der Cardano-Blockchain sind endgültig und können nicht rückgängig gemacht werden.</li>
          <li>
            Zum Schutz gilt ein Limit von {formatFiat(NEW_USER_MAX_FIAT_CENTS, "EUR")} pro Handel, solange eine Seite neu ist.
          </li>
          <li>Kursangaben stammen von Drittanbietern und sind ohne Gewähr.</li>
        </ul>
      </section>

      <section id="bedingungen">
        <h2>Nutzungsbedingungen (Kurzfassung)</h2>
        <ol>
          <li>Die Plattform stellt einen Marktplatz bereit, auf dem Nutzer Angebote zum Kauf und Verkauf von ADA einstellen und Handelspartner finden.</li>
          <li>Verträge kommen ausschließlich zwischen den Handelspartnern zustande. Die Plattform ist nicht Vertragspartei.</li>
          <li>Nutzer müssen volljährig sein und dürfen nur mit eigenen Konten und eigenen Wallets handeln.</li>
          <li>Verboten sind Betrug, Geldwäsche, Zahlungen über Dritte, falsche Zahlungsbestätigungen und Belästigung.</li>
          <li>Jeder Nutzer ist für die steuerliche Behandlung seiner Trades selbst verantwortlich.</li>
          <li>Bei Verstößen können Angebote entfernt und Konten gesperrt werden. In Streitfällen entscheidet die Moderation nach Aktenlage.</li>
          <li>Die Plattform haftet nicht für das Verhalten von Handelspartnern; die Haftung für Vorsatz und grobe Fahrlässigkeit bleibt unberührt.</li>
        </ol>
      </section>

      <section id="datenschutz">
        <h2>Datenschutz</h2>
        <p>Wir verarbeiten nur, was für den Betrieb des Marktplatzes nötig ist:</p>
        <ul>
          <li>
            <strong>Wallet-Daten:</strong> deine Stake-Adresse (als Konto-Kennung) und eine Empfangsadresse deiner Wallet.
            Beide sind auf der Blockchain ohnehin öffentlich.
          </li>
          <li>
            <strong>Nutzungsdaten:</strong> Anzeigename, Angebote, Trades, Chatnachrichten und Bewertungen. Chats sehen nur die
            beiden Handelspartner und bei Streitfällen die Moderation.
          </li>
          <li>
            <strong>Cookie:</strong> ein technisch notwendiges Sitzungs-Cookie für die Anmeldung. Kein Tracking, keine Werbung,
            keine externen Schriftarten.
          </li>
          <li>
            <strong>Hosting:</strong> Netlify, Inc. (USA) verarbeitet als Auftragsverarbeiter u. a. IP-Adressen in Server-Logs
            und zur Missbrauchsabwehr. Die Übermittlung erfolgt auf Grundlage des EU-US Data Privacy Framework bzw.
            Standardvertragsklauseln.
          </li>
          <li>
            <strong>Drittanbieter:</strong> Kurse werden serverseitig bei CoinGecko bzw. Kraken abgefragt, Treuhand-Adressen und
            Transaktionen über die Koios-API geprüft und eingereicht. Für die Hinterlegung übermittelt deine Wallet ihre
            UTxOs (öffentliche Blockchain-Daten) an unseren Server, der daraus die Transaktion baut.
          </li>
        </ul>
        <p>
          Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO (Nutzung des Marktplatzes) und lit. f (Sicherheit). Du hast das Recht
          auf Auskunft, Berichtigung, Löschung, Einschränkung, Datenübertragbarkeit und Widerspruch sowie auf Beschwerde bei
          einer Aufsichtsbehörde. Wende dich dazu an den unten genannten Betreiber.
        </p>
      </section>

      <section id="impressum">
        <h2>Impressum</h2>
        <p>Angaben gemäß § 5 DDG:</p>
        <Operator />
      </section>
    </div>
  );
}
