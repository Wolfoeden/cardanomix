# CardanoMix P2P – Plan

Peer-to-Peer-Marktplatz für ADA gegen Fiat (EUR, USD, CHF, GBP) auf
cardanomix.com. Die Plattform verwahrt **keine** Coins und kein Geld: Käufer und
Verkäufer zahlen direkt aneinander, die Plattform bringt sie zusammen, führt den
Handel Schritt für Schritt und prüft die ADA-Überweisung auf der Blockchain.

## Ziele der ersten Version (MVP)

1. Angebote einstellen und durchsuchen (ADA kaufen / ADA verkaufen).
2. Anmeldung nur mit Cardano-Wallet (CIP-30 + Signatur nach CIP-8), kein Passwort,
   keine E-Mail.
3. Geführter Handel mit Zahlungsfrist, Chat, Statusverlauf und On-Chain-Nachweis.
4. Vertrauen durch Bewertungen, Abschlussquote und Limits für neue Konten.
5. Streitfälle mit Moderation durch Admin-Wallets.
6. Läuft komplett auf Netlify (statische Seite + Functions + Netlify Database).

## Architektur

| Teil | Technik |
| --- | --- |
| Frontend | Vite + React + React Router, eigenes CSS, keine externen Schriften oder Tracker |
| API | Eine Netlify Function `netlify/functions/api.mts` unter `/api/*` mit kleinem Router |
| Datenbank | Netlify Database (Postgres), Migrationen in `netlify/database/migrations/` |
| Login | CIP-30 `signData` → COSE_Sign1 wird serverseitig mit Ed25519 geprüft, Schlüssel-Hash muss zur Adresse passen; Sitzung als HMAC-signiertes HttpOnly-Cookie |
| Kurse | Server holt ADA-Kurs von CoinGecko (Ersatz: Kraken) und cached ihn 60 s |
| On-Chain-Prüfung | Koios-API: Transaktion muss bestätigt sein, nach Handelsbeginn liegen und mindestens den Betrag an die Käuferadresse senden |
| Lokal & Tests | PGlite (Postgres als WASM) statt Netlify Database, Mock-Wallet für Playwright |

## Handelsablauf

```
Angebot (Maker)  ──► Handel starten (Taker): Betrag wird im Angebot reserviert
                     Status: awaiting_payment (Zahlungsfrist läuft)
Käufer zahlt Fiat ─► "Als bezahlt markieren"           → paid
Verkäufer sendet ADA an die Käuferadresse und trägt den Tx-Hash ein
                  ─► Prüfung über Koios                → completed
                     (alternativ: Käufer bestätigt den Erhalt → completed)
Abbruch: Käufer jederzeit vor Zahlung, Verkäufer erst nach Ablauf der Frist
         → cancelled, Betrag geht zurück ins Angebot
Streitfall aus "paid" heraus → disputed → Admin entscheidet: completed / cancelled
Nach Abschluss: gegenseitige Bewertung (positiv/negativ + Kommentar)
```

Schutzregeln:

- Eigene Angebote können nicht gehandelt werden.
- Konten mit weniger als 3 abgeschlossenen Trades: höchstens 300 Fiat-Einheiten pro Handel.
- Ein Tx-Hash kann nur einmal verwendet werden.
- Zustandswechsel laufen atomar in der Datenbank (`UPDATE … WHERE status = …`, `SELECT … FOR UPDATE`).
- Schreibende Anfragen nur vom eigenen Origin, Cookies `HttpOnly; Secure; SameSite=Lax`.
- Rate-Limit auf der API-Function, strenge Content-Security-Policy.

## Seiten

- `/` Marktplatz mit Kurs, Filtern (Kaufen/Verkaufen, Währung, Zahlungsart, Betrag)
- `/angebot/neu`, `/angebot/:id` Angebot anlegen / ansehen und Handel starten
- `/handel/:id` Handelsraum mit Status, Countdown, Chat und Aktionen
- `/konto` meine Trades, meine Angebote, Profilname
- `/nutzer/:id` öffentliches Profil mit Bewertungen
- `/admin` Streitfälle (nur Admin-Wallets)
- `/so-funktionierts`, `/rechtliches`

## Umsetzungsschritte

1. Projektgerüst, Datenbankschema, Migrationen.
2. Backend: Signaturprüfung, Sitzungen, Angebote, Trades, Chat, Bewertungen, Admin.
3. Frontend: Layout, Wallet-Verbindung, alle Seiten, responsives Design.
4. Tests: Unit-Tests (Signatur, Preise, Handelslogik gegen PGlite), End-to-End-Durchlauf
   eines kompletten Trades mit zwei Mock-Wallets.
5. GitHub-Repository `cardanomix-p2p` anlegen und pushen.
6. Netlify-Projekt `cardanomix-p2p`: `SESSION_SECRET` setzen, deployen, live prüfen.
7. Domain `cardanomix.com` im Netlify-Projekt hinterlegen (Domain-Einstellungen).

## Konfiguration (Umgebungsvariablen)

| Variable | Zweck |
| --- | --- |
| `SESSION_SECRET` | Pflicht. Mindestens 32 Zeichen, signiert Sitzungs-Cookies |
| `CARDANO_NETWORK` | `mainnet` (Standard) oder `preprod` zum Testen |
| `ADMIN_STAKE_ADDRESSES` | Kommagetrennte Stake-Adressen mit Admin-Rechten |
| `COINGECKO_API_KEY` | Optional, Demo-Key gegen Rate-Limits |
| `KOIOS_API_TOKEN` | Optional, Koios-Token für höhere Limits |

## Phase 2: Treuhand für die Krypto-Seite (in Umsetzung)

Entscheidung: Die Treuhand hält nur die ADA. Den Fiat-Eingang bestätigt der Verkäufer per
Button, danach werden die ADA an den Käufer ausgelöst.

**Treuhand-Adresse pro Handel** (Native Script, kein Plutus):

```
any [
  atLeast 2 [ Verkäufer, Käufer, CardanoMix-Schlichter ],
  all [ Verkäufer, nach Slot (Handelsbeginn + 14 Tage) ]
]
```

- Schlüssel von Käufer und Verkäufer: Zahlungsschlüssel ihrer Wallet-Adressen.
- Schlichter-Schlüssel wird pro Handel aus `ESCROW_ARBITER_SECRET` abgeleitet
  (HMAC-SHA256 über die Handels-ID) – dadurch ist jede Treuhand-Adresse einzigartig.
- CardanoMix allein kann nichts bewegen. Fällt CardanoMix aus, holt der Verkäufer die ADA
  nach 14 Tagen allein zurück.

**Ablauf**

```
Handel startet           → awaiting_escrow  (Verkäufer hinterlegt Menge + 2 ADA Gebührenpuffer)
Hinterlegung bestätigt   → awaiting_payment (erst jetzt zahlt der Käufer)
„Ich habe bezahlt“       → paid
„Zahlung erhalten – ADA freigeben“ (Verkäufer signiert, CardanoMix signiert mit)
                         → completed, ADA gehen an den Käufer, Rest an den Verkäufer
Abbruch/Frist abgelaufen → cancelled, Verkäufer holt die ADA zurück (Verkäufer + CardanoMix)
Streitfall               → Moderation entscheidet; Begünstigter holt die ADA ab (+ CardanoMix)
```

- Transaktionen baut der Server mit der Cardano-Referenzbibliothek (CSL); Wallets signieren
  per CIP-30 `signTx`. Vor jeder Signatur zeigt die Oberfläche Empfänger, Beträge und Gebühr.
- Der Server signiert als Schlichter nur, wenn der Handelsstatus die Auszahlung erlaubt,
  und nur Transaktionen, die er selbst gebaut hat.
- Hinterlegung und Auszahlung werden über Koios auf der Blockchain geprüft.
- Bestehende Trades ohne Treuhand laufen im alten Ablauf weiter.

**Vor breitem Einsatz:** Durchlauf auf Preprod bzw. mit Kleinstbeträgen, Test der gängigen
Wallets (Eternl, Lace, Vespr, Yoroi, Typhon), externes Review.

## Später

- Atomarer Tausch Cardano-Asset gegen Cardano-Asset (eine gemeinsame Transaktion).
- Native Tokens (z. B. USDM, DJED, iUSD, SNEK) zusätzlich zu ADA.
- Benachrichtigungen (E-Mail/Telegram) bei neuen Trades und Nachrichten.
- Verifizierte Händler, Mehrsprachigkeit (EN).

## Rechtliches – vor dem Livebetrieb klären

Ein Marktplatz, der Käufer und Verkäufer von Kryptowerten zusammenbringt, kann in der
EU unter MiCA (Krypto-Dienstleister) und das Geldwäschegesetz fallen – auch ohne
Verwahrung. Vor dem öffentlichen Start mit echtem Geld: rechtliche Prüfung,
Impressum und Datenschutzerklärung mit echten Angaben, ggf. KYC-Anbindung.
