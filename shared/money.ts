import { LOVELACE_PER_ADA, type Fiat } from "./constants";

/**
 * Parst eine Dezimalzahl ohne Tausendertrennzeichen ("12,5" oder "12.5") in eine
 * Ganzzahl mit `decimals` Nachkommastellen. Mehr Nachkommastellen als erlaubt → null.
 */
export function parseDecimal(input: string, decimals: number): number | null {
  const value = input.trim().replace(",", ".");
  const match = /^(\d{1,15})(?:\.(\d+))?$/.exec(value);
  if (!match) return null;
  const whole = match[1];
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) return null;
  const result = Number(whole) * 10 ** decimals + Number(fraction.padEnd(decimals, "0") || "0");
  return Number.isSafeInteger(result) ? result : null;
}

export const parseAdaToLovelace = (input: string) => parseDecimal(input, 6);
export const parseFiatToCents = (input: string) => parseDecimal(input, 2);
/** Preis pro ADA mit bis zu 6 Nachkommastellen → Mikro-Einheiten. */
export const parsePriceToMicro = (input: string) => parseDecimal(input, 6);

/** Fiat-Betrag in Cent für eine ADA-Menge zum Preis (Mikro-Fiat pro ADA), kaufmännisch gerundet. */
export function fiatCentsFor(lovelace: number, priceMicro: number): number {
  const numerator = BigInt(lovelace) * BigInt(priceMicro);
  const divisor = 10_000_000_000n; // 1e6 (Lovelace→ADA) * 1e6 (Mikro→Fiat) / 100 (Fiat→Cent)
  return Number((numerator + divisor / 2n) / divisor);
}

/** ADA-Menge in Lovelace, die man für `fiatCents` zum Preis bekommt (abgerundet). */
export function lovelaceFor(fiatCents: number, priceMicro: number): number {
  return Number((BigInt(fiatCents) * 10_000_000_000n) / BigInt(priceMicro));
}

/** Marktpreis mit Auf-/Abschlag in Basispunkten. */
export function applyMargin(marketPriceMicro: number, marginBps: number): number {
  return Math.round((marketPriceMicro * (10_000 + marginBps)) / 10_000);
}

const adaFormat = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 0, maximumFractionDigits: 6 });

export function formatAda(lovelace: number): string {
  return `${adaFormat.format(lovelace / LOVELACE_PER_ADA)} ADA`;
}

/** ADA-Betrag als Zahl ohne Einheit, z. B. für Kopieren in die Wallet ("12.5"). */
export function lovelaceToAdaString(lovelace: number): string {
  const whole = Math.floor(lovelace / LOVELACE_PER_ADA);
  const fraction = String(lovelace % LOVELACE_PER_ADA).padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

const fiatFormats = new Map<string, Intl.NumberFormat>();

export function formatFiat(cents: number, fiat: Fiat): string {
  let format = fiatFormats.get(fiat);
  if (!format) {
    format = new Intl.NumberFormat("de-DE", { style: "currency", currency: fiat });
    fiatFormats.set(fiat, format);
  }
  return format.format(cents / 100);
}

const priceFormats = new Map<string, Intl.NumberFormat>();

/** Preis pro ADA, z. B. "0,4512 €". */
export function formatPrice(priceMicro: number, fiat: Fiat): string {
  let format = priceFormats.get(fiat);
  if (!format) {
    format = new Intl.NumberFormat("de-DE", {
      style: "currency",
      currency: fiat,
      minimumFractionDigits: 4,
      maximumFractionDigits: 4,
    });
    priceFormats.set(fiat, format);
  }
  return format.format(priceMicro / 1_000_000);
}

export function formatMargin(bps: number): string {
  const percent = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 }).format(Math.abs(bps) / 100);
  if (bps === 0) return "Marktpreis";
  return `${bps > 0 ? "+" : "−"}${percent} % zum Markt`;
}
