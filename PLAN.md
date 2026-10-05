# Marktplatzumfang und Abnahme

## Implementierter Umfang

Waren, digitale Produkte und Dienstleistungen, je eine Einheit. Kategorien, Suche, ADA-Preisfilter und Sortierung. Entwurf, geprüfte Bilder, Veröffentlichung, Pause, Archivierung und Duplikat (Bilder neu hochladen). Private Chats und Bestelldaten; Meldungen, Ausblenden, Sperren und dokumentierte Streitfalllösung.

Atomare Reservierung mit eingefrorenem Preis, Versand und Empfängern. Genau 1 ADA Gebühr, separate Verkäufer- und Gebührenausgänge, aktuelles Mindest-ADA, tatsächliche UTxO-Prüfung und Signaturprüfung gegen den gespeicherten Transaktionskörper. Der Hash ist eindeutig. Nach zehn Bestätigungen bezahlt; Versand/Leistung durch Verkäufer und Abschluss durch Käufer.

Unvorbereitete Reservierungen verfallen nach 15 Minuten. Vorbereitete oder eingereichte Transaktionen bleiben bis zum bestätigten Ablauf reserviert. Koios-Ausfälle und bereits verbrauchte Eingänge geben die Einheit nicht frei. Nur ein frischer Blockchain-Tip nach TTL plus Sicherheitsabstand erlaubt die Freigabe. Wiederholtes Einreichen verwendet denselben gespeicherten signierten Körper.

## Abnahme

- npm run check und npm run test:e2e.
- scripts/storage-smoke.mjs: echter Supabase-Upload, Bildverarbeitung, signierte URLs und anschließendes Entfernen der Testobjekte; Geschäftsdaten bleiben lokal.
- scripts/preprod-smoke.mjs: echte Test-ADA, zwei Parteien, Gebühr, zehn Bestätigungen und Abschluss. Zahlungshash als Beleg speichern.
- scripts/rehearse-migration.mjs: tatsächliche Quelldaten mit vollständigen Zeilenprüfsummen; Identitätssequenz und Treuhandfelder erhalten.
- Vor/nach Migration Tabellenberechtigungen von game und drip vergleichen.
- Nach Veröffentlichung Deployment-Commit, Health, Marktplatz, alte ADA-Links und Bildspeicher prüfen.

## Bewusste Grenzen

Keine Auktionen, Warenkörbe, automatische NFT-Transfers, automatische Rückerstattungen oder Garantie der Lieferung. Pro Angebot eine Einheit. Das Duplikat kopiert Angebotsdaten und erfordert eigene Bild-Uploads. Cloud-Vorschauen haben keinen Produktionsdatenbankzugang; vollständige Vorschautests laufen lokal.
