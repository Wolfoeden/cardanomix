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

/**
 * Simuliert Koios: Bekannt sind nur Transaktionen, die vorher über `registerFakeTx`
 * hinterlegt wurden; sie gelten als bestätigt und zahlen den hinterlegten Betrag an die Adresse.
 */
const fakeTxs = new Map<string, { address: string; lovelace: number }>();

export function registerFakeTx(hash: string, address: string, lovelace: number): void {
  fakeTxs.set(hash, { address, lovelace });
}

export function fakeChainFetch(): typeof fetch {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.includes("koios.rest")) return fetch(input, init);
    const body = JSON.parse(String(init?.body ?? "{}")) as { _tx_hashes?: string[] };
    const txs = (body._tx_hashes ?? []).flatMap((hash) => {
      const tx = fakeTxs.get(hash);
      if (!tx) return [];
      return [
        {
          tx_hash: hash,
          block_height: 1,
          tx_timestamp: Math.floor(Date.now() / 1000),
          outputs: [{ payment_addr: { bech32: tx.address }, value: String(tx.lovelace) }],
        },
      ];
    });
    return new Response(JSON.stringify(txs), { headers: { "content-type": "application/json" } });
  };
}
