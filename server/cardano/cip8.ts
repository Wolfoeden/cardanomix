import { ed25519 } from "@noble/curves/ed25519.js";
import { blake2b } from "@noble/hashes/blake2.js";
import { addressToBech32, parseAddressBytes, sameBytes, type ParsedAddress } from "./address";
import { decodeCbor } from "./cbor";

/**
 * Prüft eine CIP-30-`signData`-Signatur (COSE_Sign1 nach CIP-8).
 *
 * Gültig ist sie nur, wenn
 * - die Ed25519-Signatur über die COSE-Sig_structure stimmt,
 * - die signierte Nachricht genau `expectedMessage` ist und
 * - der Hash des öffentlichen Schlüssels zur signierten Adresse gehört
 *   (Stake-Schlüssel bei Stake-Adressen, sonst Zahlungsschlüssel).
 */
export interface VerifiedSignature {
  address: ParsedAddress;
  addressBech32: string;
  publicKey: Uint8Array;
}

const ALG_EDDSA = -8;
const COSE_KEY_X = -2;

export class SignatureError extends Error {}

function decode(hex: string): unknown {
  if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0 || hex.length > 8_000) {
    throw new SignatureError("Signatur ist kein gültiges Hex");
  }
  try {
    return decodeCbor(Buffer.from(hex, "hex"));
  } catch {
    throw new SignatureError("Signatur ist kein gültiges CBOR");
  }
}

function asBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  return null;
}

function unwrapTag(value: unknown): unknown {
  // COSE_Sign1 darf mit CBOR-Tag 18 versehen sein.
  if (value && typeof value === "object" && "tag" in value && "value" in value) {
    return (value as { value: unknown }).value;
  }
  return value;
}

function bstrHeader(length: number): Uint8Array {
  if (length < 24) return Uint8Array.of(0x40 + length);
  if (length < 0x100) return Uint8Array.of(0x58, length);
  if (length < 0x10000) return Uint8Array.of(0x59, length >> 8, length & 0xff);
  return Uint8Array.of(0x5a, (length >>> 24) & 0xff, (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Sig_structure = ["Signature1", protected, external_aad = h'', payload] als CBOR. */
export function sigStructure(protectedHeader: Uint8Array, payload: Uint8Array): Uint8Array {
  const context = new TextEncoder().encode("Signature1");
  return concat([
    Uint8Array.of(0x84),
    Uint8Array.of(0x60 + context.length),
    context,
    bstrHeader(protectedHeader.length),
    protectedHeader,
    bstrHeader(0),
    bstrHeader(payload.length),
    payload,
  ]);
}

export function verifyDataSignature(
  signatureHex: string,
  keyHex: string,
  expectedMessage: string,
): VerifiedSignature {
  const sign1 = unwrapTag(decode(signatureHex));
  if (!Array.isArray(sign1) || sign1.length !== 4) throw new SignatureError("COSE_Sign1 hat nicht vier Felder");
  const [protectedRaw, unprotected, payloadRaw, signatureRaw] = sign1;

  const protectedBytes = asBytes(protectedRaw);
  const signature = asBytes(signatureRaw);
  const payload = asBytes(payloadRaw);
  if (!protectedBytes || !signature || signature.length !== 64) throw new SignatureError("Signaturfelder fehlen");
  if (!payload) throw new SignatureError("Signierte Nachricht fehlt");

  let headers: unknown;
  try {
    headers = decodeCbor(protectedBytes);
  } catch {
    throw new SignatureError("Geschützter Header ist kein gültiges CBOR");
  }
  if (!(headers instanceof Map)) throw new SignatureError("Geschützter Header ist keine Map");
  const alg = headers.get(1);
  if (alg !== undefined && alg !== ALG_EDDSA) throw new SignatureError("Nur EdDSA-Signaturen werden akzeptiert");
  const addressBytes = asBytes(headers.get("address"));
  if (!addressBytes) throw new SignatureError("Adresse fehlt im Header");

  const coseKey = decode(keyHex);
  if (!(coseKey instanceof Map)) throw new SignatureError("COSE_Key ist keine Map");
  const publicKey = asBytes(coseKey.get(COSE_KEY_X));
  if (!publicKey || publicKey.length !== 32) throw new SignatureError("Öffentlicher Schlüssel fehlt");

  const messageBytes = new TextEncoder().encode(expectedMessage);
  const hashed = unprotected instanceof Map && unprotected.get("hashed") === true;
  const expectedPayload = hashed ? blake2b(messageBytes, { dkLen: 28 }) : messageBytes;
  if (!sameBytes(payload, expectedPayload)) throw new SignatureError("Signierte Nachricht stimmt nicht");

  let valid = false;
  try {
    valid = ed25519.verify(signature, sigStructure(protectedBytes, payload), publicKey);
  } catch {
    valid = false;
  }
  if (!valid) throw new SignatureError("Signatur ist ungültig");

  const address = parseAddressBytes(addressBytes);
  if (!address) throw new SignatureError("Unbekanntes Adressformat");
  const keyHash = blake2b(publicKey, { dkLen: 28 });
  const expectedHash = address.kind === "reward" ? address.stakeKeyHash : address.paymentKeyHash;
  if (!sameBytes(keyHash, expectedHash)) throw new SignatureError("Schlüssel gehört nicht zur Adresse");

  return { address, addressBech32: addressToBech32(addressBytes), publicKey };
}
