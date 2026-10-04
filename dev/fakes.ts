import type { PriceSource } from "../server/prices";

/** Feste Kurse für lokale Entwicklung und End-to-End-Tests ohne Internetzugang. */
export const FAKE_PRICES_MICRO = { EUR: 450_000, USD: 520_000, CHF: 420_000, GBP: 390_000 } as const;

export function fakePriceSource(): PriceSource {
  const updatedAt = new Date().toISOString();
  return {
    async get() {
      return {
        prices: Object.fromEntries(
          Object.entries(FAKE_PRICES_MICRO).map(([fiat, priceMicro]) => [fiat, { priceMicro, change24h: 1.8 }]),
        ),
        updatedAt,
        source: "Testdaten",
      };
    },
    async marketPriceMicro(fiat) {
      return FAKE_PRICES_MICRO[fiat];
    },
  };
}
