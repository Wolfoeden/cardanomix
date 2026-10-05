import type { CardanoNetwork } from "../../shared/types";

/** Nur ADA-UTxOs zählen für die Treuhand; UTxOs mit Tokens bleiben unangetastet. */
export interface ChainUtxo {
  txHash: string;
  index: number;
  lovelace: number;
  hasAssets: boolean;
}

export interface ProtocolParams {
  minFeeA: number;
  minFeeB: number;
  coinsPerUtxoByte: number;
  maxTxSize: number;
  maxValueSize: number;
  keyDeposit: number;
  poolDeposit: number;
}

/** Stand Conway-Ära; wird durch Koios überschrieben, wenn erreichbar. */
export const DEFAULT_PROTOCOL_PARAMS: ProtocolParams = {
  minFeeA: 44,
  minFeeB: 155_381,
  coinsPerUtxoByte: 4_310,
  maxTxSize: 16_384,
  maxValueSize: 5_000,
  keyDeposit: 2_000_000,
  poolDeposit: 500_000_000,
};

export class ChainError extends Error {}

export interface Chain {
  addressUtxos(address: string): Promise<ChainUtxo[]>;
  protocolParams(strict?: boolean): Promise<ProtocolParams>;
  /** Reicht eine signierte Transaktion ein und gibt den Tx-Hash zurück. */
  submit(txBytes: Uint8Array): Promise<string>;
  /** Anzahl Bestätigungen oder null, wenn die Transaktion (noch) nicht auf der Chain ist. */
  confirmations(txHash: string): Promise<number | null>;
}

const KOIOS_BASE: Record<CardanoNetwork, string> = {
  mainnet: "https://api.koios.rest/api/v1",
  preprod: "https://preprod.koios.rest/api/v1",
};

const PARAMS_TTL_MS = 60 * 60_000;

export function koiosChain(options: {
  network: CardanoNetwork;
  token?: string;
  fetch?: typeof fetch;
}): Chain {
  const doFetch = options.fetch ?? fetch;
  const base = KOIOS_BASE[options.network];
  const auth: Record<string, string> = options.token
    ? { authorization: `Bearer ${options.token}` }
    : {};
  let params: { at: number; value: ProtocolParams } | null = null;

  async function post<T>(path: string, body: unknown): Promise<T> {
    let response: Response;
    try {
      response = await doFetch(`${base}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          ...auth,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ChainError(
        "Die Blockchain-Abfrage ist gerade nicht erreichbar.",
      );
    }
    if (!response.ok)
      throw new ChainError(
        `Blockchain-Abfrage fehlgeschlagen (${response.status}).`,
      );
    return (await response.json()) as T;
  }

  return {
    async addressUtxos(address) {
      const rows = await post<
        {
          tx_hash: string;
          tx_index: number;
          value: string | number;
          asset_list?: unknown[] | null;
        }[]
      >("/address_utxos", { _addresses: [address], _extended: true });
      return (Array.isArray(rows) ? rows : []).map((row) => ({
        txHash: row.tx_hash,
        index: Number(row.tx_index),
        lovelace: Number(row.value),
        hasAssets: Array.isArray(row.asset_list) && row.asset_list.length > 0,
      }));
    },

    async protocolParams(strict = false) {
      if (!strict && params && Date.now() - params.at < PARAMS_TTL_MS)
        return params.value;
      try {
        const response = await doFetch(`${base}/cli_protocol_params`, {
          headers: { accept: "application/json", ...auth },
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error(String(response.status));
        const raw = (await response.json()) as Record<string, unknown>;
        const num = (key: string, fallback: number) => {
          const value = Number(raw[key]);
          if (Number.isSafeInteger(value) && value > 0) return value;
          if (strict) throw new Error(`Missing protocol parameter: ${key}`);
          return fallback;
        };
        const value: ProtocolParams = {
          minFeeA: num("txFeePerByte", DEFAULT_PROTOCOL_PARAMS.minFeeA),
          minFeeB: num("txFeeFixed", DEFAULT_PROTOCOL_PARAMS.minFeeB),
          coinsPerUtxoByte: num(
            "utxoCostPerByte",
            DEFAULT_PROTOCOL_PARAMS.coinsPerUtxoByte,
          ),
          maxTxSize: num("maxTxSize", DEFAULT_PROTOCOL_PARAMS.maxTxSize),
          maxValueSize: num(
            "maxValueSize",
            DEFAULT_PROTOCOL_PARAMS.maxValueSize,
          ),
          keyDeposit: num(
            "stakeAddressDeposit",
            DEFAULT_PROTOCOL_PARAMS.keyDeposit,
          ),
          poolDeposit: num(
            "stakePoolDeposit",
            DEFAULT_PROTOCOL_PARAMS.poolDeposit,
          ),
        };
        params = { at: Date.now(), value };
        return value;
      } catch {
        if (strict)
          throw new ChainError(
            "Aktuelle Netzwerkparameter nicht erreichbar. Bitte später erneut versuchen.",
          );
        return params?.value ?? DEFAULT_PROTOCOL_PARAMS;
      }
    },

    async submit(txBytes) {
      let response: Response;
      try {
        response = await doFetch(`${base}/submittx`, {
          method: "POST",
          headers: {
            "content-type": "application/cbor",
            accept: "application/json",
            ...auth,
          },
          body: new Uint8Array(txBytes),
          signal: AbortSignal.timeout(15_000),
        });
      } catch {
        throw new ChainError(
          "Die Transaktion konnte nicht eingereicht werden: Blockchain-Dienst nicht erreichbar.",
        );
      }
      const text = await response.text();
      if (!response.ok) {
        throw new ChainError(
          `Die Blockchain hat die Transaktion abgelehnt: ${text.slice(0, 300)}`,
        );
      }
      return text.replace(/"/g, "").trim();
    },

    async confirmations(txHash) {
      const rows = await post<
        { tx_hash: string; num_confirmations: number | null }[]
      >("/tx_status", {
        _tx_hashes: [txHash],
      });
      const row = Array.isArray(rows)
        ? rows.find((item) => item.tx_hash === txHash)
        : undefined;
      return row?.num_confirmations ?? null;
    },
  };
}
