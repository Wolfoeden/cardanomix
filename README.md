# CardanoMix P2P

Peer-to-Peer-Marktplatz für ADA gegen EUR, USD, CHF und GBP – gedacht als Ergänzung zu
[cardanomix.com](https://cardanomix.com), gehostet auf Netlify.

- **Keine Verwahrung:** Fiat geht direkt an den Verkäufer, ADA direkt in die Wallet des Käufers.
- **Wallet-Login:** Anmeldung per CIP-30-Wallet und Signatur (CIP-8), ohne Passwort oder E-Mail.
- **On-Chain-Prüfung:** Ein Handel schließt erst ab, wenn die ADA-Transaktion über Koios bestätigt ist
  (oder der Käufer den Erhalt bestätigt).
- **Vertrauen:** Bewertungen, Abschlussquote, Limits für neue Konten, Zahlungsfristen mit automatischem
  Abbruch, Streitfälle mit Moderation.

Der Plan mit Architektur, Handelsablauf und Roadmap steht in [PLAN.md](PLAN.md).

## Aufbau

| Pfad | Inhalt |
| --- | --- |
| `src/` | React-Frontend (Vite, React Router) |
| `server/` | API-Logik: Router, Login, Angebote, Trades, Kurse, Cardano-Hilfen |
| `shared/` | Typen, Konstanten und Geldrechnung für Frontend und Backend |
| `netlify/functions/api.mts` | Netlify Function für alle Anfragen unter `/api/*` |
| `netlify/functions/expire-trades.mts` | Zeitgesteuerte Function: bricht überfällige Trades ab |
| `netlify/database/migrations/` | SQL-Migrationen für Netlify Database (Postgres) |
| `dev/` | Lokale Entwicklung: PGlite statt Postgres, Vite-Plugin für die API, Testdaten |
| `tests/` | Unit-/Integrationstests (Vitest + PGlite) und End-to-End-Tests (Playwright) |

## Lokal starten

```bash
npm install
npm run dev            # http://localhost:5173 – API läuft im Vite-Server, Daten in .data/pglite
```

Ohne Internetzugang oder zum Ausprobieren:

```bash
CMX_FAKE_PRICES=1 CMX_FAKE_CHAIN=1 CMX_DB=memory npm run dev
```

## Tests

```bash
npm run typecheck
npm test               # Signaturprüfung, CBOR, Koios-Prüfung, kompletter API-Ablauf gegen PGlite
npm run test:e2e       # Browser-Durchlauf eines Handels mit zwei Test-Wallets
```

Ist Chromium nicht über Playwright installiert, den Pfad mit `PW_CHROMIUM_PATH=/pfad/zu/chrome` angeben.

## Deployment auf Netlify

1. Repository mit dem Netlify-Projekt verbinden (Build-Befehl und Publish-Ordner stehen in `netlify.toml`).
2. Umgebungsvariablen setzen:

   | Variable | Pflicht | Zweck |
   | --- | --- | --- |
   | `SESSION_SECRET` | ja | Mindestens 32 zufällige Zeichen, signiert die Sitzungs-Cookies |
   | `CARDANO_NETWORK` | nein | `mainnet` (Standard) oder `preprod` zum Testen |
   | `ADMIN_STAKE_ADDRESSES` | nein | Kommagetrennte Stake-Adressen (`stake1…`) der Moderatoren |
   | `COINGECKO_API_KEY` | nein | Demo-Key gegen Rate-Limits der Kursabfrage |
   | `KOIOS_API_TOKEN` | nein | Token für höhere Koios-Limits |

3. Deployen. Netlify Database wird beim ersten Deploy automatisch angelegt und die Migrationen werden
   vor der Veröffentlichung eingespielt.
4. Eigene Domain, z. B. `p2p.cardanomix.com`, unter *Domain management* hinzufügen.

## Vor dem öffentlichen Start

- Impressum und Betreiberangaben in `src/legal.ts` eintragen.
- Rechtliche Einordnung klären: Ein Marktplatz für Kryptowerte kann unter MiCA und das Geldwäschegesetz
  fallen, auch ohne Verwahrung.
- Ersten Testlauf mit `CARDANO_NETWORK=preprod` und Test-ADA machen.
