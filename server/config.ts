import type { CardanoNetwork } from "../shared/types";

export interface AppConfig {
  sessionSecret: string | null;
  /** Geheimnis, aus dem die Schlichter-Schlüssel der Treuhand abgeleitet werden. Ohne es keine neuen Trades. */
  arbiterSecret: string | null;
  network: CardanoNetwork;
  adminIdentities: Set<string>;
  coingeckoKey?: string;
  koiosToken?: string;
}

export function readConfig(getEnv: (name: string) => string | undefined): AppConfig {
  const secret = getEnv("SESSION_SECRET")?.trim();
  const arbiter = getEnv("ESCROW_ARBITER_SECRET")?.trim();
  const network = getEnv("CARDANO_NETWORK")?.trim() === "preprod" ? "preprod" : "mainnet";
  const admins = (getEnv("ADMIN_STAKE_ADDRESSES") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return {
    sessionSecret: secret && secret.length >= 32 ? secret : null,
    arbiterSecret: arbiter && arbiter.length >= 32 ? arbiter : null,
    network,
    adminIdentities: new Set(admins),
    coingeckoKey: getEnv("COINGECKO_API_KEY")?.trim() || undefined,
    koiosToken: getEnv("KOIOS_API_TOKEN")?.trim() || undefined,
  };
}

export const networkId = (network: CardanoNetwork): 0 | 1 => (network === "mainnet" ? 1 : 0);
