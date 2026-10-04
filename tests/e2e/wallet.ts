import type { Browser, BrowserContext, Page } from "@playwright/test";
import { createTestWallet, type TestWallet } from "../helpers/wallet.ts";

export const BASE_URL = "http://localhost:5174";

const ICON =
  "data:image/svg+xml;base64," +
  Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" rx="2" fill="#7b61ff"/></svg>').toString("base64");

/** Neuer Browser-Kontext mit einer CIP-30-Testwallet unter window.cardano.testwallet. */
export async function contextWithWallet(
  browser: Browser,
  seed: string,
  viewport?: { width: number; height: number },
): Promise<{ context: BrowserContext; page: Page; wallet: TestWallet }> {
  const wallet = createTestWallet(seed);
  const context = await browser.newContext(viewport ? { viewport } : {});
  await context.exposeFunction("__cmxSign", (address: string, payload: string) => wallet.signData(address, payload));
  await context.exposeFunction("__cmxSignTx", (tx: string) => wallet.signTx(tx));
  await context.exposeFunction("__cmxUtxos", async () => {
    const response = await fetch(`${BASE_URL}/__dev/ledger/utxos?address=${wallet.baseAddress}`);
    return ((await response.json()) as { utxos: string[] }).utxos;
  });
  await context.addInitScript(
    ({ base, reward, icon }) => {
      const w = window as unknown as {
        cardano?: Record<string, unknown>;
        __cmxSign: (a: string, p: string) => Promise<{ signature: string; key: string }>;
        __cmxSignTx: (tx: string) => Promise<string>;
        __cmxUtxos: () => Promise<string[]>;
      };
      w.cardano = w.cardano ?? {};
      w.cardano.testwallet = {
        name: "Testwallet",
        icon,
        apiVersion: "0.1.0",
        isEnabled: async () => true,
        enable: async () => ({
          getNetworkId: async () => 1,
          getChangeAddress: async () => base,
          getRewardAddresses: async () => [reward],
          getUsedAddresses: async () => [base],
          getUtxos: () => w.__cmxUtxos(),
          signData: (address: string, payload: string) => w.__cmxSign(address, payload),
          signTx: (tx: string) => w.__cmxSignTx(tx),
        }),
      };
    },
    { base: wallet.baseAddressHex, reward: wallet.rewardAddressHex, icon: ICON },
  );
  const page = await context.newPage();
  return { context, page, wallet };
}

export async function connectWallet(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog", { name: "Mit Wallet anmelden" });
  await dialog.waitFor();
  await dialog.getByRole("button", { name: /Testwallet/ }).click();
  await dialog.waitFor({ state: "detached" });
}

export async function fund(address: string, ada: number): Promise<void> {
  await fetch(`${BASE_URL}/__dev/ledger/fund`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address, lovelace: ada * 1_000_000 }),
  });
}

export async function balanceAda(address: string): Promise<number> {
  const response = await fetch(`${BASE_URL}/__dev/ledger/utxos?address=${address}`);
  return ((await response.json()) as { lovelace: number }).lovelace / 1_000_000;
}
