import { describe, expect, it } from "vitest";
import { addressToBech32, parseAddress, rewardAddressFor } from "../../server/cardano/address";
import { verifyDataSignature } from "../../server/cardano/cip8";
import { checkPayment } from "../../server/cardano/koios";
import { createTestWallet, utf8ToHex } from "../helpers/wallet";

describe("Cardano-Adressen", () => {
  it("dekodiert eine bekannte Mainnet-Basisadresse aus CIP-19", () => {
    // Testvektor aus CIP-19 (addr1 mit Schlüssel/Schlüssel)
    const address =
      "addr1qx2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgse35a3x";
    const parsed = parseAddress(address);
    expect(parsed?.kind).toBe("base");
    expect(parsed?.networkId).toBe(1);
    expect(addressToBech32(parsed!.bytes)).toBe(address);
    expect(addressToBech32(rewardAddressFor(parsed!)!)).toBe(
      "stake1uyehkck0lajq8gr28t9uxnuvgcqrc6070x3k9r8048z8y5gh6ffgw",
    );
  });

  it("lehnt Unsinn und falsche Präfixe ab", () => {
    expect(parseAddress("hallo")).toBeNull();
    expect(parseAddress("addr1qqqq")).toBeNull();
  });

  it("erzeugt Test-Wallets mit gültigen Bech32-Adressen", () => {
    const wallet = createTestWallet("a");
    expect(wallet.baseAddress.startsWith("addr1")).toBe(true);
    expect(wallet.rewardAddress.startsWith("stake1")).toBe(true);
    const testnet = createTestWallet("a", 0);
    expect(testnet.baseAddress.startsWith("addr_test1")).toBe(true);
  });
});

describe("CIP-8-Signaturprüfung", () => {
  const wallet = createTestWallet("signer");
  const message = "CardanoMix P2P – Anmeldung\nNonce: 123";

  it("akzeptiert eine Signatur mit dem Stake-Schlüssel", () => {
    const { signature, key } = wallet.signData(wallet.rewardAddressHex, utf8ToHex(message));
    const verified = verifyDataSignature(signature, key, message);
    expect(verified.address.kind).toBe("reward");
    expect(verified.addressBech32).toBe(wallet.rewardAddress);
  });

  it("akzeptiert eine Signatur mit dem Zahlungsschlüssel", () => {
    const { signature, key } = wallet.signData(wallet.baseAddressHex, utf8ToHex(message));
    expect(verifyDataSignature(signature, key, message).addressBech32).toBe(wallet.baseAddress);
  });

  it("lehnt eine andere Nachricht ab", () => {
    const { signature, key } = wallet.signData(wallet.rewardAddressHex, utf8ToHex(message));
    expect(() => verifyDataSignature(signature, key, `${message}x`)).toThrow(/Nachricht/);
  });

  it("lehnt einen Schlüssel ab, der nicht zur Adresse gehört", () => {
    const other = createTestWallet("other");
    const { signature } = wallet.signData(wallet.rewardAddressHex, utf8ToHex(message));
    const { key } = other.signData(other.rewardAddressHex, utf8ToHex(message));
    // Fremder Schlüssel → Signatur passt nicht mehr
    expect(() => verifyDataSignature(signature, key, message)).toThrow();
  });

  it("lehnt eine Signatur ab, die eine fremde Adresse behauptet", () => {
    const victim = createTestWallet("victim");
    // Angreifer signiert korrekt, trägt aber die Adresse des Opfers in den Header ein
    const { signature, key } = wallet.signData(victim.rewardAddressHex, utf8ToHex(message));
    expect(() => verifyDataSignature(signature, key, message)).toThrow(/gehört nicht/);
  });

  it("lehnt kaputte Eingaben ab", () => {
    expect(() => verifyDataSignature("zz", "00", message)).toThrow();
    expect(() => verifyDataSignature("a0", "a0", message)).toThrow();
  });
});

describe("On-Chain-Prüfung über Koios", () => {
  const buyer = createTestWallet("buyer").baseAddress;
  const hash = "a".repeat(64);
  const start = new Date("2026-10-01T12:00:00Z");

  function koios(body: unknown, status = 200): typeof fetch {
    return async () => new Response(JSON.stringify(body), { status });
  }

  const check = (fetchImpl: typeof fetch, minLovelace = 10_000_000) =>
    checkPayment({ txHash: hash, toAddress: buyer, minLovelace, notBefore: start }, { network: "mainnet", fetch: fetchImpl });

  const tx = (outputs: { address: string; value: number }[], timestamp = start.getTime() / 1000 + 60) => [
    {
      tx_hash: hash,
      block_height: 100,
      tx_timestamp: timestamp,
      outputs: outputs.map((output) => ({ payment_addr: { bech32: output.address }, value: String(output.value) })),
    },
  ];

  it("bestätigt eine ausreichende Zahlung an die Käuferadresse", async () => {
    const result = await check(koios(tx([{ address: buyer, value: 6_000_000 }, { address: buyer, value: 4_000_000 }])));
    expect(result).toEqual({ ok: true, receivedLovelace: 10_000_000 });
  });

  it("meldet zu wenig ADA", async () => {
    const result = await check(koios(tx([{ address: buyer, value: 9_999_999 }])));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe("insufficient");
  });

  it("meldet Zahlungen an andere Adressen als fehlend", async () => {
    const result = await check(koios(tx([{ address: createTestWallet("x").baseAddress, value: 50_000_000 }])));
    expect(!result.ok && result.reason).toBe("insufficient");
  });

  it("lehnt Transaktionen vor Handelsbeginn ab", async () => {
    const result = await check(koios(tx([{ address: buyer, value: 10_000_000 }], start.getTime() / 1000 - 3600)));
    expect(!result.ok && result.reason).toBe("too_old");
  });

  it("meldet unbestätigte oder unbekannte Transaktionen", async () => {
    expect(await check(koios([]))).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("meldet Ausfälle der API", async () => {
    expect(await check(koios({}, 500))).toMatchObject({ ok: false, reason: "unavailable" });
  });
});
