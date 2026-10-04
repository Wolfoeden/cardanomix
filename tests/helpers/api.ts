import { createApp } from "../../server/app";
import type { AppConfig } from "../../server/config";
import type { AppContext } from "../../server/context";
import { createPgliteDb } from "../../dev/pglite";
import { fakePriceSource } from "../../dev/fakes";
import { createTestWallet, utf8ToHex, type TestWallet } from "./wallet";

export const ORIGIN = "https://p2p.example.test";

export interface KoiosTx {
  hash: string;
  address: string;
  lovelace: number;
  timestamp: number;
}

export async function createTestApi(overrides: Partial<AppConfig> = {}) {
  const { db, pg } = await createPgliteDb();
  let now = new Date("2026-10-01T12:00:00Z");
  const chain = new Map<string, KoiosTx>();
  const ctx: AppContext = {
    db,
    config: {
      sessionSecret: "test-secret-test-secret-test-secret-123",
      network: "mainnet",
      adminIdentities: new Set(),
      ...overrides,
    },
    prices: fakePriceSource(),
    fetch: async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { _tx_hashes: string[] };
      const txs = body._tx_hashes.flatMap((hash) => {
        const tx = chain.get(hash);
        return tx
          ? [
              {
                tx_hash: hash,
                block_height: 1,
                tx_timestamp: tx.timestamp,
                outputs: [{ payment_addr: { bech32: tx.address }, value: String(tx.lovelace) }],
              },
            ]
          : [];
      });
      return Response.json(txs);
    },
    now: () => now,
  };
  const handle = createApp(ctx);

  async function call<T = any>(
    method: string,
    path: string,
    options: { body?: unknown; cookie?: string; origin?: string | null } = {},
  ): Promise<{ status: number; body: T; setCookie: string | null }> {
    const headers = new Headers({ host: new URL(ORIGIN).host });
    if (options.cookie) headers.set("cookie", options.cookie);
    if (method !== "GET" && options.origin !== null) headers.set("origin", options.origin ?? ORIGIN);
    if (options.body !== undefined) headers.set("content-type", "application/json");
    const response = await handle(
      new Request(`${ORIGIN}${path}`, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      }),
    );
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null, setCookie: response.headers.get("set-cookie") };
  }

  async function login(seed: string, wallet: TestWallet = createTestWallet(seed)) {
    const challenge = await call<{ nonce: string; message: string }>("GET", "/api/auth/challenge");
    const signed = wallet.signData(wallet.rewardAddressHex, utf8ToHex(challenge.body.message));
    const result = await call("POST", "/api/auth/login", {
      body: { nonce: challenge.body.nonce, ...signed, receiveAddress: wallet.baseAddressHex },
    });
    if (result.status !== 200) throw new Error(`Login fehlgeschlagen: ${JSON.stringify(result.body)}`);
    const cookie = result.setCookie!.split(";")[0];
    return { cookie, user: result.body.user, wallet };
  }

  return {
    ctx,
    pg,
    call,
    login,
    chain,
    setNow: (date: Date) => {
      now = date;
    },
    getNow: () => now,
  };
}

export const sellOffer = {
  side: "sell",
  fiat: "EUR",
  priceType: "fixed",
  fixedPrice: "0,50",
  amountAda: "1000",
  minFiat: "10",
  maxFiat: "250",
  paymentMethods: ["SEPA", "WISE"],
  terms: "Nur SEPA von eigenem Konto.",
  paymentWindowMin: 30,
} as const;
