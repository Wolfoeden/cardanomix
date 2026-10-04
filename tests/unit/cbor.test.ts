import { Encoder } from "cbor-x";
import { describe, expect, it } from "vitest";
import { decodeCbor } from "../../server/cardano/cbor";
import { verifyDataSignature } from "../../server/cardano/cip8";
import { createTestWallet, utf8ToHex } from "../helpers/wallet";

const hex = (value: string) => Uint8Array.from(Buffer.from(value, "hex"));

describe("CBOR-Decoder", () => {
  it("liest Werte, die cbor-x erzeugt", () => {
    const encoder = new Encoder({ useRecords: false, mapsAsObjects: false });
    const value = [1, -8, "address", Buffer.from([1, 2, 3]), new Map<unknown, unknown>([[1, -8], ["hashed", false]]), null, true];
    const decoded = decodeCbor(new Uint8Array(encoder.encode(value))) as unknown[];
    expect(decoded[0]).toBe(1);
    expect(decoded[1]).toBe(-8);
    expect(decoded[2]).toBe("address");
    expect(Array.from(decoded[3] as Uint8Array)).toEqual([1, 2, 3]);
    expect(decoded[4]).toEqual(new Map<unknown, unknown>([[1, -8], ["hashed", false]]));
    expect(decoded.slice(5)).toEqual([null, true]);
  });

  it("liest Byte-Strings unbestimmter Länge und Tags", () => {
    expect(Array.from(decodeCbor(hex("5f42010241 03ff".replace(/ /g, ""))) as Uint8Array)).toEqual([1, 2, 3]);
    expect(decodeCbor(hex("d28201 02".replace(/ /g, "")))).toEqual({ tag: 18, value: [1, 2] });
    expect(decodeCbor(hex("1903e8"))).toBe(1000);
    expect(decodeCbor(hex("3863"))).toBe(-100);
  });

  it("lehnt abgeschnittene und überlange Daten ab", () => {
    expect(() => decodeCbor(hex("5820aa"))).toThrow(/unerwartet/);
    expect(() => decodeCbor(hex("0101"))).toThrow(/Überzählige/);
    expect(() => decodeCbor(hex("9a7fffffff"))).toThrow(/Zu viele/);
  });

  it("akzeptiert COSE_Sign1 mit Tag 18", () => {
    const wallet = createTestWallet("tagged");
    const message = "Hallo";
    const { signature, key } = wallet.signData(wallet.rewardAddressHex, utf8ToHex(message));
    // Tag 18 (0xd2) vor das Array setzen
    expect(verifyDataSignature(`d2${signature}`, key, message).addressBech32).toBe(wallet.rewardAddress);
  });
});
