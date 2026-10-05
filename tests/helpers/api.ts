import { createApp } from "../../server/app";
import type { AppConfig } from "../../server/config";
import type { AppContext } from "../../server/context";
import { createPgliteDb } from "../../dev/pglite";
import { fakePriceSource } from "../../dev/fakes";
import { FakeLedger } from "../../dev/fake-ledger";
import { createTestWallet, utf8ToHex, type TestWallet } from "./wallet";

export const ORIGIN = "https://p2p.example.test";
export const ADA = 1_000_000;

export async function createTestApi(
  overrides: Partial<AppConfig> = {},
  dataDir?: string,
) {
  const { db, pg } = await createPgliteDb(dataDir);
  let now = new Date("2026-10-01T12:00:00Z");
  const ledger = new FakeLedger("mainnet", () => now);
  ledger.confirmationCount = 10;
  const ctx: AppContext = {
    db,
    config: {
      sessionSecret: "test-secret-test-secret-test-secret-123",
      arbiterSecret: "schlichter-geheimnis-fuer-tests-0123456789",
      network: "mainnet",
      adminIdentities: new Set(),
      ...overrides,
    },
    prices: fakePriceSource(),
    fetch: ledger.fetch,
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
    if (method !== "GET" && options.origin !== null)
      headers.set("origin", options.origin ?? ORIGIN);
    if (options.body !== undefined)
      headers.set("content-type", "application/json");
    const response = await handle(
      new Request(`${ORIGIN}${path}`, {
        method,
        headers,
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
      }),
    );
    const text = await response.text();
    return {
      status: response.status,
      body: text ? JSON.parse(text) : null,
      setCookie: response.headers.get("set-cookie"),
    };
  }

  async function login(
    seed: string,
    wallet: TestWallet = createTestWallet(seed),
  ) {
    const challenge = await call<{ nonce: string; message: string }>(
      "GET",
      "/api/auth/challenge",
    );
    const signed = wallet.signData(
      wallet.rewardAddressHex,
      utf8ToHex(challenge.body.message),
    );
    const result = await call("POST", "/api/auth/login", {
      body: {
        nonce: challenge.body.nonce,
        ...signed,
        receiveAddress: wallet.baseAddressHex,
      },
    });
    if (result.status !== 200)
      throw new Error(`Login fehlgeschlagen: ${JSON.stringify(result.body)}`);
    const cookie = result.setCookie!.split(";")[0];
    return { cookie, user: result.body.user, wallet };
  }

  type Party = { cookie: string; wallet: TestWallet };

  /** Verkäufer hinterlegt über den Wallet-Ablauf (UTxOs → Server baut → Wallet signiert → Server reicht ein). */
  async function deposit(seller: Party, tradeId: string) {
    if (ledger.balance(seller.wallet.baseAddress) < 1_000 * ADA)
      ledger.fund(seller.wallet.baseAddress, 5_000 * ADA);
    const prepared = await call(
      "POST",
      `/api/trades/${tradeId}/escrow/deposit-tx`,
      {
        cookie: seller.cookie,
        body: {
          utxos: ledger
            .utxosAt(seller.wallet.baseAddress)
            .map((utxo) => utxo.outputHex),
          changeAddress: seller.wallet.baseAddressHex,
        },
      },
    );
    if (prepared.status !== 200) return prepared;
    const submitted = await call(
      "POST",
      `/api/trades/${tradeId}/escrow/deposit`,
      {
        cookie: seller.cookie,
        body: {
          tx: prepared.body.txHex,
          witnessSet: seller.wallet.signTx(prepared.body.txHex),
        },
      },
    );
    if (submitted.status !== 200) return submitted;
    return call("POST", `/api/trades/${tradeId}/escrow/check`, {
      cookie: seller.cookie,
    });
  }

  /** Auszahlung: Server baut, Wallet signiert, Server signiert als Schlichter mit und reicht ein. */
  async function payout(
    party: Party,
    tradeId: string,
    kind: "release" | "refund",
    signer: TestWallet = party.wallet,
  ) {
    const prepared = await call(
      "POST",
      `/api/trades/${tradeId}/escrow/payout-tx`,
      { cookie: party.cookie, body: { kind } },
    );
    if (prepared.status !== 200) return prepared;
    return call("POST", `/api/trades/${tradeId}/escrow/payout`, {
      cookie: party.cookie,
      body: { witnessSet: signer.signTx(prepared.body.txHex) },
    });
  }

  return {
    ctx,
    pg,
    ledger,
    call,
    login,
    deposit,
    payout,
    setNow: (date: Date) => {
      now = date;
    },
    getNow: () => now,
    advance: (minutes: number) => {
      now = new Date(now.getTime() + minutes * 60_000);
    },
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
