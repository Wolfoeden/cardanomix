import { expect, test, type Page } from "@playwright/test";
import { connectWallet, contextWithWallet } from "./wallet.ts";

const SHOTS = process.env.SCREENSHOT_DIR ?? "test-results/screens";
const shot = (page: Page, name: string) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });

test("kompletter Handel: Angebot, Kauf, Zahlung, On-Chain-Prüfung, Bewertung", async ({ browser }) => {
  const seller = await contextWithWallet(browser, "e2e-seller");
  const buyer = await contextWithWallet(browser, "e2e-buyer");

  // Startseite ohne Angebote
  await seller.page.goto("/");
  await expect(seller.page.getByRole("heading", { name: "ADA direkt von Mensch zu Mensch handeln" })).toBeVisible();
  await expect(seller.page.getByText("Noch keine passenden Angebote")).toBeVisible();
  await shot(seller.page, "01-start-leer");

  // Verkäufer meldet sich an und erstellt ein Angebot
  await seller.page.getByRole("button", { name: "Wallet verbinden" }).click();
  await connectWallet(seller.page);
  await expect(seller.page.locator(".account-button")).toBeVisible();

  await seller.page.getByRole("link", { name: "Angebot erstellen" }).first().click();
  await seller.page.getByRole("radio", { name: "Festpreis" }).click();
  await seller.page.getByLabel("Festpreis pro ADA in EUR").fill("0,50");
  await seller.page.getByLabel("Menge zum Verkauf").fill("500");
  await seller.page.getByLabel("Mindestbetrag pro Handel").fill("10");
  await seller.page.getByLabel("Höchstbetrag pro Handel").fill("200");
  await seller.page.getByLabel("Wise").check();
  await seller.page.getByLabel("Bedingungen (optional)").fill("Bitte nur von eigenem Konto überweisen.");
  await expect(seller.page.getByText("Dein Preis: 0,5000 €")).toBeVisible();
  await shot(seller.page, "02-angebot-erstellen");
  await seller.page.getByRole("button", { name: "Angebot veröffentlichen" }).click();
  await expect(seller.page.getByText("Dein Angebot ist veröffentlicht")).toBeVisible();
  await shot(seller.page, "03-meine-angebote");

  // Käufer findet das Angebot und startet einen Handel
  await buyer.page.goto("/");
  const row = buyer.page.locator(".offer-row").first();
  await expect(row.getByText("0,5000 €")).toBeVisible();
  await shot(buyer.page, "04-marktplatz");
  await row.getByRole("link", { name: "ADA kaufen" }).click();
  await buyer.page.getByLabel("Betrag in EUR").fill("20");
  await expect(buyer.page.locator(".preview").getByText("40 ADA")).toBeVisible();
  await shot(buyer.page, "05-angebot-detail");
  await buyer.page.getByRole("button", { name: "Mit Wallet anmelden & starten" }).click();
  await connectWallet(buyer.page);
  await buyer.page.waitForURL(/\/handel\//);
  await expect(buyer.page.getByRole("heading", { name: "Bitte 20,00 € bezahlen" })).toBeVisible();
  const tradeUrl = buyer.page.url();

  await buyer.page.getByLabel("Nachricht").fill("Hallo! Bitte schick mir deine IBAN.");
  await buyer.page.getByRole("button", { name: "Senden" }).click();
  await expect(buyer.page.locator(".chat-own").getByText("Bitte schick mir deine IBAN")).toBeVisible();

  // Verkäufer sieht den Handel und antwortet
  await seller.page.goto("/konto");
  await seller.page.locator(".list-row").first().click();
  await expect(seller.page.getByRole("heading", { name: "Warte auf die Zahlung" })).toBeVisible();
  await expect(seller.page.getByText("Bitte schick mir deine IBAN")).toBeVisible();
  await seller.page.getByLabel("Nachricht").fill("IBAN: DE00 1234 5678 9000 0000 00, Verwendungszweck: Handel 42");
  await seller.page.keyboard.press("Enter");
  await expect(seller.page.locator(".chat-own").getByText("DE00 1234")).toBeVisible();

  // Käufer zahlt und markiert die Zahlung
  await expect(buyer.page.getByText("DE00 1234")).toBeVisible({ timeout: 10_000 });
  await shot(buyer.page, "06-handel-kaeufer");
  await buyer.page.getByRole("button", { name: "Ich habe bezahlt" }).click();
  await buyer.page.getByRole("dialog").getByRole("button", { name: "Ja, ich habe bezahlt" }).click();
  await expect(buyer.page.getByRole("heading", { name: "Der Verkäufer ist am Zug" })).toBeVisible();

  // Verkäufer sendet ADA (simuliert) und meldet den Tx-Hash
  await seller.page.reload();
  await expect(seller.page.getByRole("heading", { name: "Zahlungseingang prüfen, dann ADA senden" })).toBeVisible();
  const txHash = "e2".repeat(32);
  const response = await seller.page.request.post("/__dev/fake-tx", {
    data: { hash: txHash, address: buyer.wallet.baseAddress, lovelace: 40_000_000 },
  });
  expect(response.status()).toBe(204);
  await expect(seller.page.locator(".address-box").getByText(buyer.wallet.baseAddress)).toBeVisible();
  await shot(seller.page, "07-handel-verkaeufer");
  await seller.page.getByLabel("Transaktions-ID (Tx-Hash) deiner ADA-Zahlung").fill(txHash);
  await seller.page.getByRole("button", { name: "Zahlung prüfen & abschließen" }).click();
  await expect(seller.page.getByRole("heading", { name: "Handel abgeschlossen" })).toBeVisible();

  // Käufer sieht den Abschluss und bewertet
  await buyer.page.goto(tradeUrl);
  await expect(buyer.page.getByRole("heading", { name: "Handel abgeschlossen" })).toBeVisible();
  await buyer.page.getByRole("radio", { name: "Positiv" }).click();
  await buyer.page.getByLabel("Kommentar").fill("Schnell und freundlich.");
  await buyer.page.getByRole("button", { name: "Bewertung abgeben" }).click();
  await expect(buyer.page.getByText("Schnell und freundlich.")).toBeVisible();
  await shot(buyer.page, "08-abgeschlossen");

  // Profil des Verkäufers zeigt Trade und Bewertung
  await buyer.page.locator(".facts").getByRole("link").first().click();
  await expect(buyer.page.locator(".profile-stats")).toContainText("1Trades");
  await expect(buyer.page.locator(".profile-stats")).toContainText("100 %");
  await shot(buyer.page, "09-profil");

  // Angebot hat jetzt 40 ADA weniger
  await buyer.page.goto("/");
  await expect(buyer.page.locator(".offer-row").first()).toContainText("460 ADA");

  // Dunkelmodus
  await buyer.page.emulateMedia({ colorScheme: "dark" });
  await shot(buyer.page, "12-dunkel-marktplatz");
  await seller.page.emulateMedia({ colorScheme: "dark" });
  await seller.page.goto(tradeUrl);
  await expect(seller.page.getByRole("heading", { name: "Handel abgeschlossen" })).toBeVisible();
  await shot(seller.page, "13-dunkel-handel");

  await seller.context.close();
  await buyer.context.close();
});

test("Mobilansicht und Info-Seiten", async ({ browser }) => {
  const { page, context } = await contextWithWallet(browser, "e2e-mobile", { width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Menü öffnen" })).toBeVisible();
  await shot(page, "10-mobil-start");
  await page.getByRole("button", { name: "Menü öffnen" }).click();
  await page.getByRole("navigation", { name: "Hauptnavigation" }).getByRole("link", { name: "So funktioniert’s" }).click();
  await expect(page.getByRole("heading", { name: "So funktioniert CardanoMix P2P" })).toBeVisible();
  await shot(page, "11-mobil-so-gehts");
  await page.goto("/rechtliches#datenschutz");
  await expect(page.getByRole("heading", { name: "Datenschutz" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await page.goto("/gibts-nicht");
  await expect(page.getByRole("heading", { name: "Seite nicht gefunden" })).toBeVisible();
  await context.close();
});

test("Moderation ist nur für Admin-Wallets", async ({ browser }) => {
  const { page, context } = await contextWithWallet(browser, "e2e-admin");
  await page.goto("/admin");
  await expect(page.getByText("Dieser Bereich ist nur für Moderatoren.")).toBeVisible();
  await page.getByRole("button", { name: "Wallet verbinden" }).click();
  await connectWallet(page);
  await expect(page.getByText("Keine offenen Streitfälle")).toBeVisible();
  await context.close();
});
