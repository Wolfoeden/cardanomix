# CardanoMix

Allgemeiner Marktplatz für Waren, digitale Produkte und Dienstleistungen. Kostenlos inserieren; Käufer zahlen Kaufpreis und Versand direkt an den Verkäufer sowie exakt 1 ADA Plattformgebühr. Der bestehende ADA/Fiat-Handel mit Native-Script-Treuhand bleibt unter /ada-handeln verfügbar.

Eine Blockchain-Zahlung beweist keine Lieferung: bezahlt, versandt/erbracht und abgeschlossen sind getrennte Zustände. Rückzahlungen müssen Verkäufer separat signieren.

## Entwicklung

Node.js 22 oder neuer. npm ci, anschließend npm run dev. Lokale Daten liegen in .data/pglite. Nach einem Wechsel von der früheren lokalen Datenbank eine neue Datenbank verwenden.

Für vollständig isolierte lokale Tests: CMX_DB=memory CMX_FAKE_PRICES=1 CMX_FAKE_CHAIN=1 CMX_FAKE_STORAGE=1 npm run dev. Diese Optionen simulieren Blockchain und Bildspeicher. Sie werden ausschließlich vom lokalen Vite-Server verwendet.

npm run check prüft TypeScript, API-/Sicherheitstests und den Build. npm run test:e2e prüft zwei CIP-30-Testwallets, Upload, privaten Chat, exakte Transaktionsausgänge und den bestehenden Treuhandablauf. PW_CHROMIUM_PATH kann eine vorhandene Chromium-Installation auswählen.

## Architektur

- src/pages/Marketplace.tsx, ListingEditor.tsx, ListingDetail.tsx, Order.tsx und Messages.tsx: Marktplatz und Bestellablauf.
- server/marketplace/: Eigentümer- und Teilnehmerprüfung, SQL-Transaktionen, Bildverarbeitung, Reservierungen, Zahlungen und Moderation.
- shared/marketplace.ts: gemeinsame Typen, Kategorien, Status und feste Gebührenadresse.
- supabase/migrations/: neues Schema cardanomix mit Legacy- und Marktplatztabellen, RLS, eigenem Backendnutzer und privaten Buckets.
- netlify/functions/marketplace-maintenance.mts: Zahlungsabgleich, Reservierungen und Uploadbereinigung alle zwei Minuten.
- scripts/: geprüfter Export/Import, lokale Migrationsprobe, echte Storage- und Preprod-Smoke-Tests.

Alle Geschäftstabellen sind schemaqualifiziert. Der Browser erhält keinen Datenbankzugang und keinen Supabase-Serverschlüssel. Die API nutzt pg mit dem Supabase-Transaktionspooler und eigenen Berechtigungen für cardanomix. game und drip werden nicht verändert.

## Produktion

Supabase-Projekt 300: uhxwaonnkvicfekzefbn. Netlify-Site cardanomix-p2p: 5f438ba3-8763-4bd6-b502-144ec5c4329b. Konfiguration ausschließlich für Production; bestehende SESSION_SECRET und ESCROW_ARBITER_SECRET erhalten.

| Variable                | Zweck                                                                             |
| ----------------------- | --------------------------------------------------------------------------------- |
| CARDANOMIX_DATABASE_URL | Transaktionspooler, Port 6543, Nutzer cardanomix_backend.uhxwaonnkvicfekzefbn     |
| CARDANOMIX_DATABASE_CA  | Supabase-CA als PEM; Zertifikat und Hostname werden geprüft                       |
| CARDANOMIX_ENVIRONMENT  | production; Produktionsdatenbank ist anderen Deployment-Kontexten gesperrt        |
| SUPABASE_URL            | https://uhxwaonnkvicfekzefbn.supabase.co                                          |
| SUPABASE_SECRET_KEY     | Serverschlüssel ausschließlich für Backend/Storage                                |
| PLATFORM_FEE_ADDRESS    | Gebührenadresse aus shared/marketplace.ts; auf Preprod eine Testadresse verwenden |
| SESSION_SECRET          | Unverändertes Sitzungssignaturgeheimnis                                           |
| ESCROW_ARBITER_SECRET   | Unverändertes Geheimnis zur Ableitung bestehender Treuhandschlüssel               |
| CARDANO_NETWORK         | mainnet oder preprod                                                              |
| ADMIN_STAKE_ADDRESSES   | Moderator-Wallets                                                                 |

Vorschauen erhalten keine Produktionsschlüssel. Vollständige Vorschautests erfolgen lokal mit Testdaten und Preprod. Unkonfigurierte Cloud-Vorschauen geben für Datenbankoperationen einen Fehler zurück.

Private Buckets: cardanomix-uploads und cardanomix-images. Maximal zehn Bilder pro Angebot, je 5 MiB; JPEG, PNG und WebP. Nur tatsächlich decodierbare, verkleinerte WebP-Bilder ohne EXIF werden ausgeliefert. Bild-URLs gelten fünf Minuten. Originale und verworfene Uploads werden nach 24 Stunden bereinigt.

## Produktionswechsel

1. Änderungen und echten Preprod-Smoke-Test prüfen. Preprod verwendet eine eigene lokale Datenbank und mindestens 30 Test-ADA; keine Mainnet-ADA. PREPROD_WALLETS_FILE muss außerhalb des Repositorys liegen. node scripts/preprod-smoke.mjs --prepare erzeugt Testadressen; anschließend node scripts/preprod-smoke.mjs. Die Testdatenbank hält vorbereitete und eingereichte Zahlungen für Wiederaufnahme fest.
2. Quelle zunächst mit SOURCE_DATABASE_URL und node scripts/migrate-to-supabase.mjs snapshot PRIVATE_FILE sichern. node scripts/rehearse-migration.mjs PRIVATE_FILE vergleicht lokal sämtliche Zeilen einschließlich IDs und Treuhandfeldern.
3. Schreibzugriffe kurz über eine Wartungsveröffentlichung sperren und alte geplante Functions währenddessen deaktivieren. Erst danach einen neuen, maßgeblichen Snapshot erstellen.
4. Leeres Ziel mit CARDANOMIX_DATABASE_URL und CARDANOMIX_DATABASE_CA_FILE konfigurieren. node scripts/migrate-to-supabase.mjs import PRIVATE_FILE importiert atomar mit unveränderten IDs, setzt die Nachrichtensequenz fort und vergleicht vollständige Zeilenprüfsummen. Es überschreibt keine bereits belegten Zieltabellen. verify wiederholt die Prüfung ohne Schreiben.
5. Geprüften Git-Commit auf Netlify unter Linux bauen. Native sharp- und Cardano-Abhängigkeiten dürfen nicht aus einem Windows-Installationsverzeichnis nach Linux kopiert werden.
6. /api/health, /api/listings, /ada-handeln sowie alte /angebot/ und /handel/-Links prüfen. Deployment-ID und Commit festhalten. Bestehende Treuhandadressen und Scripts müssen vor/nach Import identisch sein.

Rollback vor Wiederaufnahme von Schreibzugriffen: vorheriges Netlify-Deployment wieder veröffentlichen. Nach neuen Schreibzugriffen ist ein Datenabgleich erforderlich; kein blindes Zurückschalten auf die alte Datenbank.
