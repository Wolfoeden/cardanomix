import { ed25519 } from "@noble/curves/ed25519.js";
import { blake2b } from "@noble/hashes/blake2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { Encoder } from "cbor-x";
import { addressToBech32 } from "../../server/cardano/address";
import { sigStructure } from "../../server/cardano/cip8";

const encoder = new Encoder({ useRecords: false, mapsAsObjects: false });
const cbor = (value: unknown) => new Uint8Array(encoder.encode(value));
const buf = (bytes: Uint8Array) => Buffer.from(bytes);

export interface TestWallet {
  networkId: number;
  baseAddressHex: string;
  rewardAddressHex: string;
  baseAddress: string;
  rewardAddress: string;
  /** CIP-30 signData: signiert mit dem Stake-Schlüssel bei Stake-Adresse, sonst mit dem Zahlungsschlüssel. */
  signData(addressHex: string, payloadHex: string): { signature: string; key: string };
}

/** Deterministische Test-Wallet mit echten Ed25519-Schlüsseln und CIP-19-Adressen. */
export function createTestWallet(seed: string, networkId = 1): TestWallet {
  const paymentPriv = sha256(new TextEncoder().encode(`payment:${seed}`));
  const stakePriv = sha256(new TextEncoder().encode(`stake:${seed}`));
  const paymentPub = ed25519.getPublicKey(paymentPriv);
  const stakePub = ed25519.getPublicKey(stakePriv);
  const paymentHash = blake2b(paymentPub, { dkLen: 28 });
  const stakeHash = blake2b(stakePub, { dkLen: 28 });

  const base = new Uint8Array(57);
  base[0] = 0x00 | networkId;
  base.set(paymentHash, 1);
  base.set(stakeHash, 29);
  const reward = new Uint8Array(29);
  reward[0] = 0xe0 | networkId;
  reward.set(stakeHash, 1);

  return {
    networkId,
    baseAddressHex: bytesToHex(base),
    rewardAddressHex: bytesToHex(reward),
    baseAddress: addressToBech32(base),
    rewardAddress: addressToBech32(reward),
    signData(addressHex, payloadHex) {
      const address = hexToBytes(addressHex);
      const useStake = (address[0] >> 4) === 0b1110;
      const priv = useStake ? stakePriv : paymentPriv;
      const pub = useStake ? stakePub : paymentPub;
      const payload = hexToBytes(payloadHex);
      const protectedHeader = cbor(
        new Map<unknown, unknown>([
          [1, -8],
          ["address", buf(address)],
        ]),
      );
      const signature = ed25519.sign(sigStructure(protectedHeader, payload), priv);
      const sign1 = cbor([buf(protectedHeader), new Map([["hashed", false]]), buf(payload), buf(signature)]);
      const key = cbor(
        new Map<number, unknown>([
          [1, 1],
          [3, -8],
          [-1, 6],
          [-2, buf(pub)],
        ]),
      );
      return { signature: bytesToHex(sign1), key: bytesToHex(key) };
    },
  };
}

export const utf8ToHex = (text: string) => bytesToHex(new TextEncoder().encode(text));
