import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { balanceAda, connectWallet, contextWithWallet, fund } from "./wallet";
import { DEFAULT_FEE_ADDRESS } from "../../shared/marketplace";

test("publish with verified pixels, chat, pay seller plus exact fee, fulfill and complete", async ({
  browser,
}) => {
  const seller = await contextWithWallet(browser, "market-e2e-seller"),
    buyer = await contextWithWallet(browser, "market-e2e-buyer");
  await fund(buyer.wallet.baseAddress, 100);
  await seller.page.goto("/");
  await seller.page.getByRole("button", { name: "Wallet verbinden" }).click();
  await connectWallet(seller.page);
  await seller.page.goto("/marktplatz/angebot/neu");
  await seller.page
    .getByLabel("Titel", { exact: true })
    .fill("Kamera für den Marktplatztest");
  await seller.page
    .getByLabel("Beschreibung", { exact: true })
    .fill("Eine Testkamera mit Objektiv und Ladegerät. Nur lokale Testdaten.");
  await seller.page
    .getByRole("combobox", { name: "Kategorie", exact: true })
    .selectOption("electronics");
  await seller.page.getByLabel("Festpreis in ADA").fill("20");
  await seller.page.getByLabel("Versandkosten in ADA").fill("2");
  await seller.page.getByRole("button", { name: "Entwurf speichern" }).click();
  await expect(
    seller.page.getByText(
      "Gespeichert. Dein Angebot ist bereit für die Vorschau.",
    ),
  ).toBeVisible();
  const pixels = await sharp({
    create: { width: 800, height: 600, channels: 3, background: "#183d80" },
  })
    .png()
    .toBuffer();
  await seller.page.getByLabel("Bilder hinzufügen").setInputFiles({
    name: "camera.png",
    mimeType: "image/png",
    buffer: pixels,
  });
  await expect(seller.page.locator(".image-edit-grid img")).toBeVisible();
  await seller.page
    .getByRole("button", { name: "Angebot veröffentlichen" })
    .click();
  await seller.page.waitForURL(/\/marktplatz\/angebot\/[a-f0-9-]+$/);
  const listingUrl = seller.page.url();
  await expect(seller.page.locator(".listing-gallery img")).toBeVisible();
  await buyer.page.goto("/");
  await buyer.page.getByRole("button", { name: "Wallet verbinden" }).click();
  await connectWallet(buyer.page);
  await buyer.page.goto(listingUrl);
  await buyer.page
    .getByRole("button", { name: "Anbieter kontaktieren" })
    .click();
  await buyer.page
    .getByLabel("Nachricht", { exact: true })
    .fill("Bitte die Kamera sicher verpacken.");
  await buyer.page.getByRole("button", { name: "Senden", exact: true }).click();
  const conversationUrl = buyer.page.url();
  await seller.page.goto(conversationUrl);
  await expect(
    seller.page.getByText("Bitte die Kamera sicher verpacken.", {
      exact: true,
    }),
  ).toBeVisible();
  await buyer.page.goto(listingUrl);
  await buyer.page
    .getByLabel("Lieferdaten (nur für die Bestellparteien)")
    .fill("Testkäufer, Teststraße 1, 12345 Berlin, Deutschland");
  await buyer.page
    .getByRole("button", { name: "Verbindlich bestellen" })
    .click();
  await buyer.page.waitForURL(/\/bestellung\//);
  const orderUrl = buyer.page.url();
  await buyer.page.getByRole("button", { name: "Zahlung vorbereiten" }).click();
  const modal = buyer.page.getByRole("dialog", {
    name: "ADA-Zahlung bestätigen",
  });
  await expect(modal.getByText("22 ADA")).toBeVisible();
  await expect(modal.getByText(/^1 ADA/)).toBeVisible();
  await modal.getByRole("button", { name: "In der Wallet bestätigen" }).click();
  await buyer.page
    .getByRole("button", { name: "Blockchain-Status prüfen" })
    .click();
  await expect(
    buyer.page.getByRole("heading", { name: "Bezahlt", exact: true }),
  ).toBeVisible();
  expect(await balanceAda(seller.wallet.baseAddress)).toBe(22);
  expect(await balanceAda(DEFAULT_FEE_ADDRESS)).toBe(1);
  await seller.page.goto(orderUrl);
  await seller.page
    .getByLabel("Versand- oder Leistungsnachweis / Grund bei Streitfall")
    .fill("Versandt, Testnachweis 123");
  await seller.page
    .getByRole("button", { name: "Als versandt / erbracht markieren" })
    .click();
  await buyer.page.reload();
  await buyer.page
    .getByRole("button", { name: "Erhalt bestätigen & abschließen" })
    .click();
  await expect(
    buyer.page.getByRole("heading", { name: "Abgeschlossen", exact: true }),
  ).toBeVisible();
  await buyer.page.screenshot({
    path: "test-results/screens/market-order-completed.png",
    fullPage: true,
  });
  await buyer.page.goto("/");
  await buyer.page.setViewportSize({ width: 390, height: 844 });
  await buyer.page.screenshot({
    path: "test-results/screens/market-mobile.png",
    fullPage: true,
  });
  await expect(buyer.page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await seller.context.close();
  await buyer.context.close();
});
