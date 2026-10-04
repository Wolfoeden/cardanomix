import { FIATS, type Fiat } from "../shared/constants";
import type { FiatPrice, PricesResponse } from "../shared/types";

const FRESH_MS = 60_000;
/** Ist die Quelle ausgefallen, werden ältere Kurse höchstens so lange weiterverwendet. */
const STALE_MS = 15 * 60_000;

interface Snapshot {
  prices: Partial<Record<Fiat, FiatPrice>>;
  fetchedAt: number;
  source: string;
}

export interface PriceSource {
  get(): Promise<PricesResponse>;
  /** Wirksamer Marktpreis in Mikro-Fiat pro ADA oder null, wenn keiner vorliegt. */
  marketPriceMicro(fiat: Fiat): Promise<number | null>;
}

async function fromCoinGecko(doFetch: typeof fetch, apiKey?: string): Promise<Snapshot> {
  const url =
    "https://api.coingecko.com/api/v3/simple/price?ids=cardano&include_24hr_change=true&vs_currencies=" +
    FIATS.map((fiat) => fiat.toLowerCase()).join(",");
  const response = await doFetch(url, {
    headers: { accept: "application/json", ...(apiKey ? { "x-cg-demo-api-key": apiKey } : {}) },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`CoinGecko ${response.status}`);
  const body = (await response.json()) as { cardano?: Record<string, number> };
  const prices: Partial<Record<Fiat, FiatPrice>> = {};
  for (const fiat of FIATS) {
    const key = fiat.toLowerCase();
    const price = body.cardano?.[key];
    if (typeof price === "number" && price > 0) {
      const change = body.cardano?.[`${key}_24h_change`];
      prices[fiat] = { priceMicro: Math.round(price * 1_000_000), change24h: typeof change === "number" ? change : null };
    }
  }
  if (Object.keys(prices).length === 0) throw new Error("CoinGecko ohne Kurse");
  return { prices, fetchedAt: Date.now(), source: "CoinGecko" };
}

async function fromKraken(doFetch: typeof fetch): Promise<Snapshot> {
  const pairs = ["ADAEUR", "ADAUSD", "ADAGBP"];
  const response = await doFetch(`https://api.kraken.com/0/public/Ticker?pair=${pairs.join(",")}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`Kraken ${response.status}`);
  const body = (await response.json()) as { result?: Record<string, { c?: string[]; o?: string }> };
  const prices: Partial<Record<Fiat, FiatPrice>> = {};
  for (const [pair, ticker] of Object.entries(body.result ?? {})) {
    const fiat = FIATS.find((candidate) => pair.endsWith(candidate));
    const last = Number(ticker.c?.[0]);
    const open = Number(ticker.o);
    if (fiat && last > 0) {
      prices[fiat] = {
        priceMicro: Math.round(last * 1_000_000),
        change24h: open > 0 ? ((last - open) / open) * 100 : null,
      };
    }
  }
  if (Object.keys(prices).length === 0) throw new Error("Kraken ohne Kurse");
  return { prices, fetchedAt: Date.now(), source: "Kraken" };
}

export function createPriceSource(options: { fetch?: typeof fetch; coingeckoKey?: string; now?: () => number } = {}): PriceSource {
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  let snapshot: Snapshot | null = null;
  let pending: Promise<Snapshot | null> | null = null;

  async function refresh(): Promise<Snapshot | null> {
    for (const load of [() => fromCoinGecko(doFetch, options.coingeckoKey), () => fromKraken(doFetch)]) {
      try {
        snapshot = await load();
        return snapshot;
      } catch {
        // nächste Quelle versuchen
      }
    }
    return snapshot && now() - snapshot.fetchedAt < STALE_MS ? snapshot : null;
  }

  async function current(): Promise<Snapshot | null> {
    if (snapshot && now() - snapshot.fetchedAt < FRESH_MS) return snapshot;
    pending ??= refresh().finally(() => {
      pending = null;
    });
    return pending;
  }

  return {
    async get() {
      const snap = await current();
      return {
        prices: snap?.prices ?? {},
        updatedAt: snap ? new Date(snap.fetchedAt).toISOString() : null,
        source: snap?.source ?? null,
      };
    },
    async marketPriceMicro(fiat) {
      const snap = await current();
      return snap?.prices[fiat]?.priceMicro ?? null;
    },
  };
}
