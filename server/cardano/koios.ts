import type { CardanoNetwork } from "../../shared/types";

export interface PaymentCheck {
  txHash: string;
  toAddress: string;
  minLovelace: number;
  /** Frühester erlaubter Zeitpunkt der Transaktion (Handelsbeginn). */
  notBefore: Date;
}

export type PaymentCheckResult =
  | { ok: true; receivedLovelace: number }
  | { ok: false; reason: "not_found" | "too_old" | "insufficient" | "unavailable"; message: string };

const KOIOS_BASE: Record<CardanoNetwork, string> = {
  mainnet: "https://api.koios.rest/api/v1",
  preprod: "https://preprod.koios.rest/api/v1",
};

/** Toleranz für Uhrenabweichung zwischen Blockchain und Server. */
const CLOCK_SKEW_SECONDS = 120;

interface KoiosOutput {
  payment_addr?: { bech32?: string } | null;
  value?: string | number | null;
}

interface KoiosTx {
  tx_hash?: string;
  block_height?: number | null;
  tx_timestamp?: number | null;
  outputs?: KoiosOutput[] | null;
}

/**
 * Prüft über Koios, ob eine bestätigte Transaktion mindestens `minLovelace` an
 * `toAddress` gesendet hat und nicht vor Handelsbeginn liegt.
 */
export async function checkPayment(
  check: PaymentCheck,
  options: { network: CardanoNetwork; token?: string; fetch?: typeof fetch },
): Promise<PaymentCheckResult> {
  const doFetch = options.fetch ?? fetch;
  let txs: KoiosTx[];
  try {
    const response = await doFetch(`${KOIOS_BASE[options.network]}/tx_info`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
      body: JSON.stringify({
        _tx_hashes: [check.txHash],
        _inputs: false,
        _metadata: false,
        _assets: false,
        _withdrawals: false,
        _certs: false,
        _scripts: false,
        _bytecode: false,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`Koios antwortet mit ${response.status}`);
    txs = (await response.json()) as KoiosTx[];
  } catch {
    return {
      ok: false,
      reason: "unavailable",
      message: "Die Blockchain-Abfrage ist gerade nicht erreichbar. Bitte gleich noch einmal prüfen.",
    };
  }

  const tx = Array.isArray(txs) ? txs.find((item) => item.tx_hash === check.txHash) : undefined;
  if (!tx || tx.block_height == null) {
    return {
      ok: false,
      reason: "not_found",
      message: "Transaktion noch nicht gefunden. Sie ist vermutlich noch nicht bestätigt – bitte in 1–2 Minuten erneut prüfen.",
    };
  }

  if (typeof tx.tx_timestamp === "number" && tx.tx_timestamp < check.notBefore.getTime() / 1000 - CLOCK_SKEW_SECONDS) {
    return {
      ok: false,
      reason: "too_old",
      message: "Diese Transaktion wurde vor Beginn des Handels erstellt und kann nicht verwendet werden.",
    };
  }

  const received = (tx.outputs ?? [])
    .filter((output) => output.payment_addr?.bech32 === check.toAddress)
    .reduce((sum, output) => sum + Number(output.value ?? 0), 0);

  if (received < check.minLovelace) {
    return {
      ok: false,
      reason: "insufficient",
      message:
        received === 0
          ? "Die Transaktion enthält keine Zahlung an die Käuferadresse."
          : "Die Transaktion sendet weniger ADA an die Käuferadresse als vereinbart.",
    };
  }

  return { ok: true, receivedLovelace: received };
}
