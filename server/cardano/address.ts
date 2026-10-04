import { bech32 } from "@scure/base";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

/** Adressarten nach CIP-19, soweit wir sie unterscheiden müssen. */
export type AddressKind = "base" | "pointer" | "enterprise" | "reward";

export interface ParsedAddress {
  bytes: Uint8Array;
  kind: AddressKind;
  networkId: number;
  /** Schlüssel-Hash der Zahlungsberechtigung, falls diese ein Schlüssel (kein Script) ist. */
  paymentKeyHash: Uint8Array | null;
  /** Schlüssel-Hash der Stake-Berechtigung, falls vorhanden und ein Schlüssel. */
  stakeKeyHash: Uint8Array | null;
  /** Stake-Berechtigung in Rohform (Schlüssel oder Script), für den Abgleich zweier Adressen. */
  stakeCredential: Uint8Array | null;
}

const HASH_LENGTH = 28;

export function parseAddressBytes(bytes: Uint8Array): ParsedAddress | null {
  if (bytes.length === 0) return null;
  const header = bytes[0];
  const type = header >> 4;
  const networkId = header & 0x0f;
  const first = bytes.slice(1, 1 + HASH_LENGTH);
  const second = bytes.slice(1 + HASH_LENGTH, 1 + 2 * HASH_LENGTH);

  switch (type) {
    case 0b0000: // Zahlung: Schlüssel, Stake: Schlüssel
    case 0b0001: // Zahlung: Script, Stake: Schlüssel
    case 0b0010: // Zahlung: Schlüssel, Stake: Script
    case 0b0011: // Zahlung: Script, Stake: Script
      if (bytes.length !== 1 + 2 * HASH_LENGTH) return null;
      return {
        bytes,
        kind: "base",
        networkId,
        paymentKeyHash: type === 0b0000 || type === 0b0010 ? first : null,
        stakeKeyHash: type === 0b0000 || type === 0b0001 ? second : null,
        stakeCredential: second,
      };
    case 0b0100:
    case 0b0101:
      if (bytes.length < 1 + HASH_LENGTH + 3) return null;
      return {
        bytes,
        kind: "pointer",
        networkId,
        paymentKeyHash: type === 0b0100 ? first : null,
        stakeKeyHash: null,
        stakeCredential: null,
      };
    case 0b0110:
    case 0b0111:
      if (bytes.length !== 1 + HASH_LENGTH) return null;
      return {
        bytes,
        kind: "enterprise",
        networkId,
        paymentKeyHash: type === 0b0110 ? first : null,
        stakeKeyHash: null,
        stakeCredential: null,
      };
    case 0b1110:
    case 0b1111:
      if (bytes.length !== 1 + HASH_LENGTH) return null;
      return {
        bytes,
        kind: "reward",
        networkId,
        paymentKeyHash: null,
        stakeKeyHash: type === 0b1110 ? first : null,
        stakeCredential: first,
      };
    default:
      return null;
  }
}

export function addressPrefix(kind: AddressKind, networkId: number): string {
  const testnet = networkId === 0;
  if (kind === "reward") return testnet ? "stake_test" : "stake";
  return testnet ? "addr_test" : "addr";
}

export function addressToBech32(bytes: Uint8Array): string {
  const parsed = parseAddressBytes(bytes);
  if (!parsed) throw new Error("Ungültige Cardano-Adresse");
  return bech32.encode(addressPrefix(parsed.kind, parsed.networkId), bech32.toWords(bytes), false);
}

/** Nimmt eine Adresse als Bech32 oder Hex (CIP-30) an und gibt die Rohbytes zurück. */
export function decodeAddress(input: string): Uint8Array | null {
  const value = input.trim();
  if (/^[0-9a-fA-F]+$/.test(value) && value.length % 2 === 0) {
    try {
      return hexToBytes(value.toLowerCase());
    } catch {
      return null;
    }
  }
  try {
    const decoded = bech32.decode(value as `${string}1${string}`, false);
    if (!["addr", "addr_test", "stake", "stake_test"].includes(decoded.prefix)) return null;
    const bytes = bech32.fromWords(decoded.words);
    const parsed = parseAddressBytes(bytes);
    if (!parsed || addressPrefix(parsed.kind, parsed.networkId) !== decoded.prefix) return null;
    return bytes;
  } catch {
    return null;
  }
}

export function parseAddress(input: string): ParsedAddress | null {
  const bytes = decodeAddress(input);
  return bytes ? parseAddressBytes(bytes) : null;
}

/** Stake-Adresse (stake1…) aus einer Basisadresse mit Stake-Schlüssel. */
export function rewardAddressFor(address: ParsedAddress): Uint8Array | null {
  if (address.kind === "reward") return address.bytes;
  if (address.kind !== "base" || !address.stakeKeyHash) return null;
  const bytes = new Uint8Array(1 + HASH_LENGTH);
  bytes[0] = (0b1110 << 4) | address.networkId;
  bytes.set(address.stakeKeyHash, 1);
  return bytes;
}

export function sameBytes(a: Uint8Array | null, b: Uint8Array | null): boolean {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export { bytesToHex, hexToBytes };
