/** CIP-30-Anbindung an Browser-Wallets (Eternl, Lace, Nami, Typhon, Vespr, Yoroi, …). */

export interface Cip30Api {
  getNetworkId(): Promise<number>;
  getChangeAddress(): Promise<string>;
  getRewardAddresses(): Promise<string[]>;
  getUsedAddresses(): Promise<string[]>;
  getUtxos(amount?: string, paginate?: { page: number; limit: number }): Promise<string[] | null | undefined>;
  signData(address: string, payload: string): Promise<{ signature: string; key: string }>;
  /** Gibt das Witness-Set (CBOR-Hex) zurück; `partialSign` erlaubt Transaktionen, die noch weitere Signaturen brauchen. */
  signTx(tx: string, partialSign?: boolean): Promise<string>;
}

interface Cip30Wallet {
  name?: string;
  icon?: string;
  apiVersion?: string;
  enable(): Promise<Cip30Api>;
}

export interface WalletInfo {
  key: string;
  name: string;
  icon: string | null;
}

declare global {
  interface Window {
    cardano?: Record<string, unknown>;
  }
}

/** Bekannte Doppel-Einträge (alte Namen derselben Wallet), die wir ausblenden. */
const ALIASES = new Set(["ccvault", "typhoncip30"]);

function isWallet(value: unknown): value is Cip30Wallet {
  return Boolean(value) && typeof value === "object" && typeof (value as Cip30Wallet).enable === "function";
}

export function listWallets(): WalletInfo[] {
  const cardano = window.cardano;
  if (!cardano) return [];
  const seen = new Set<string>();
  const wallets: WalletInfo[] = [];
  for (const [key, value] of Object.entries(cardano)) {
    if (ALIASES.has(key) || !isWallet(value)) continue;
    const name = typeof value.name === "string" && value.name ? value.name : key;
    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const icon = typeof value.icon === "string" && /^(data:image\/|https:\/\/)/.test(value.icon) ? value.icon : null;
    wallets.push({ key, name: name.charAt(0).toUpperCase() + name.slice(1), icon });
  }
  return wallets.sort((a, b) => a.name.localeCompare(b.name));
}

export async function enableWallet(key: string): Promise<Cip30Api> {
  const wallet = window.cardano?.[key];
  if (!isWallet(wallet)) throw new Error("Wallet nicht gefunden. Ist die Browser-Erweiterung installiert und entsperrt?");
  try {
    return await wallet.enable();
  } catch (error) {
    throw new Error(walletErrorMessage(error, "Die Wallet hat die Verbindung abgelehnt."));
  }
}

export function utf8ToHex(text: string): string {
  return Array.from(new TextEncoder().encode(text), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Übersetzt CIP-30-Fehler (z. B. „user declined“) in verständliche Meldungen. */
export function walletErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object") {
    const { code, info, message } = error as { code?: number; info?: string; message?: string };
    const text = `${info ?? ""} ${message ?? ""}`.toLowerCase();
    if (code === 2 || code === -3 || text.includes("declin") || text.includes("reject") || text.includes("cancel")) {
      return "In der Wallet abgelehnt.";
    }
    if (text.includes("lock")) return "Bitte die Wallet entsperren und erneut versuchen.";
    if (info) return info;
    if (message) return message;
  }
  return fallback;
}

let active: { key: string; api: Cip30Api } | null = null;

export function setActiveWallet(key: string, api: Cip30Api): void {
  active = { key, api };
}

export function clearActiveWallet(): void {
  active = null;
}

/** Die verbundene Wallet; nach einem Neuladen wird die zuletzt genutzte erneut verbunden. */
export async function activeWalletApi(): Promise<Cip30Api> {
  if (active) return active.api;
  const key = lastWallet();
  if (!key) throw new Error("Bitte verbinde zuerst deine Wallet (oben rechts).");
  const api = await enableWallet(key);
  active = { key, api };
  return api;
}

const LAST_WALLET_KEY = "cmx:last-wallet";

export function rememberWallet(key: string): void {
  try {
    localStorage.setItem(LAST_WALLET_KEY, key);
  } catch {
    // Speicher nicht verfügbar – egal
  }
}

export function lastWallet(): string | null {
  try {
    return localStorage.getItem(LAST_WALLET_KEY);
  } catch {
    return null;
  }
}
