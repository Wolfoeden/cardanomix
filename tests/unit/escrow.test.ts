import * as CSL from "@emurgo/cardano-serialization-lib-nodejs";
import { describe, expect, it } from "vitest";
import { FakeLedger } from "../../dev/fake-ledger";
import { parseAddress } from "../../server/cardano/address";
import { DEFAULT_PROTOCOL_PARAMS, koiosChain } from "../../server/escrow/chain";
import { arbiterKey, escrowAddress, escrowScript, slotAt, timeAtSlot } from "../../server/escrow/script";
import { assembleDeposit, assemblePayout, buildDepositTx, buildPayoutTx } from "../../server/escrow/tx";
import { createTestWallet } from "../helpers/wallet";

const ADA = 1_000_000;

function setup(now = new Date("2026-10-04T12:00:00Z")) {
  let clock = now;
  const ledger = new FakeLedger("mainnet", () => clock);
  const chain = koiosChain({ network: "mainnet", fetch: ledger.fetch });
  const seller = createTestWallet("escrow-seller");
  const buyer = createTestWallet("escrow-buyer");
  const arbiter = arbiterKey("geheimnis-geheimnis-geheimnis-123456", "trade-1");
  const refundSlot = slotAt("mainnet", new Date(now.getTime() + 14 * 86_400_000));
  const keyHash = (address: string) => parseAddress(address)!.paymentKeyHash!;
  const script = escrowScript({
    sellerKeyHash: keyHash(seller.baseAddress),
    buyerKeyHash: keyHash(buyer.baseAddress),
    arbiterKeyHash: arbiter.to_public().hash().to_bytes(),
    refundSlot,
  });
  const address = escrowAddress(script, "mainnet");
  const ttl = () => slotAt("mainnet", clock) + 3600;
  return { ledger, chain, seller, buyer, arbiter, script, address, keyHash, refundSlot, ttl, setNow: (d: Date) => (clock = d) };
}

async function deposit(env: ReturnType<typeof setup>, lovelace: number) {
  env.ledger.fund(env.seller.baseAddress, 500 * ADA);
  const walletUtxos = env.ledger.utxosAt(env.seller.baseAddress).map((utxo) => utxo.outputHex);
  const built = buildDepositTx({
    walletUtxos,
    changeAddress: env.seller.baseAddressHex,
    escrowAddress: env.address,
    lovelace,
    ttlSlot: env.ttl(),
    params: DEFAULT_PROTOCOL_PARAMS,
  });
  const signed = assembleDeposit({
    txHex: built.txHex,
    walletWitnessSetHex: env.seller.signTx(built.txHex),
    escrowAddress: env.address,
    minLovelace: lovelace,
  });
  return env.chain.submit(signed.txBytes);
}

describe("Treuhand-Script", () => {
  it("rechnet Slots für Mainnet und Preprod korrekt", () => {
    // Mainnet: 2024-01-01T00:00:00Z entspricht Slot 112.500.909
    expect(slotAt("mainnet", new Date("2024-01-01T00:00:00Z"))).toBe(112_500_909);
    expect(timeAtSlot("mainnet", 112_500_909).toISOString()).toBe("2024-01-01T00:00:00.000Z");
    expect(slotAt("preprod", new Date(1_655_769_600_000))).toBe(86_400);
  });

  it("erzeugt pro Handel eine eigene, stabile Adresse", () => {
    const a = setup();
    const again = escrowScript({
      sellerKeyHash: a.keyHash(a.seller.baseAddress),
      buyerKeyHash: a.keyHash(a.buyer.baseAddress),
      arbiterKeyHash: arbiterKey("geheimnis-geheimnis-geheimnis-123456", "trade-1").to_public().hash().to_bytes(),
      refundSlot: a.refundSlot,
    });
    expect(escrowAddress(again, "mainnet")).toBe(a.address);
    expect(a.address.startsWith("addr1w")).toBe(true);
    const other = arbiterKey("geheimnis-geheimnis-geheimnis-123456", "trade-2");
    expect(other.to_public().hash().to_hex()).not.toBe(a.arbiter.to_public().hash().to_hex());
    expect(escrowAddress(a.script, "preprod").startsWith("addr_test1w")).toBe(true);
  });
});

describe("Treuhand-Transaktionen gegen das Fake-Ledger", () => {
  it("Hinterlegung und Freigabe an den Käufer (Verkäufer + CardanoMix)", async () => {
    const env = setup();
    await deposit(env, 52 * ADA);
    const utxos = await env.chain.addressUtxos(env.address);
    expect(utxos.reduce((sum, u) => sum + u.lovelace, 0)).toBe(52 * ADA);

    const payout = buildPayoutTx({
      script: env.script,
      utxos,
      recipient: { address: env.buyer.baseAddress, lovelace: 50 * ADA },
      changeAddress: env.seller.baseAddress,
      signerKeyHash: env.keyHash(env.seller.baseAddress),
      arbiterKeyHash: env.arbiter.to_public().hash().to_bytes(),
      ttlSlot: env.ttl(),
      params: DEFAULT_PROTOCOL_PARAMS,
    });
    expect(payout.fee).toBeGreaterThan(150_000);
    expect(payout.fee).toBeLessThan(400_000);
    expect(payout.changeLovelace).toBe(2 * ADA - payout.fee);
    // Wallet sieht in der Transaktion das Native Script und den geforderten Unterzeichner
    const unsigned = CSL.FixedTransaction.from_hex(payout.txHex);
    expect(unsigned.witness_set().native_scripts()?.len()).toBe(1);
    expect(unsigned.body().required_signers()?.get(0).to_hex()).toBe(env.seller.paymentKeyHashHex);

    const signed = assemblePayout({
      unsignedTxHex: payout.txHex,
      walletWitnessSetHex: env.seller.signTx(payout.txHex),
      signerKeyHash: env.keyHash(env.seller.baseAddress),
      arbiter: env.arbiter,
    });
    const before = env.ledger.balance(env.buyer.baseAddress);
    const txHash = await env.chain.submit(signed.txBytes);
    expect(txHash).toBe(payout.txHash);
    expect(env.ledger.balance(env.buyer.baseAddress) - before).toBe(50 * ADA);
    expect(env.ledger.balance(env.address)).toBe(0);
    expect(await env.chain.confirmations(txHash)).toBe(1);
  });

  it("Rückzahlung an den Verkäufer", async () => {
    const env = setup();
    await deposit(env, 22 * ADA);
    const sellerBefore = env.ledger.balance(env.seller.baseAddress);
    const payout = buildPayoutTx({
      script: env.script,
      utxos: await env.chain.addressUtxos(env.address),
      recipient: null,
      changeAddress: env.seller.baseAddress,
      signerKeyHash: env.keyHash(env.seller.baseAddress),
      arbiterKeyHash: env.arbiter.to_public().hash().to_bytes(),
      ttlSlot: env.ttl(),
      params: DEFAULT_PROTOCOL_PARAMS,
    });
    const signed = assemblePayout({
      unsignedTxHex: payout.txHex,
      walletWitnessSetHex: env.seller.signTx(payout.txHex),
      signerKeyHash: env.keyHash(env.seller.baseAddress),
      arbiter: env.arbiter,
    });
    await env.chain.submit(signed.txBytes);
    expect(env.ledger.balance(env.seller.baseAddress) - sellerBefore).toBe(22 * ADA - payout.fee);
  });

  it("lehnt Signaturen der falschen Wallet ab", async () => {
    const env = setup();
    await deposit(env, 22 * ADA);
    const payout = buildPayoutTx({
      script: env.script,
      utxos: await env.chain.addressUtxos(env.address),
      recipient: { address: env.buyer.baseAddress, lovelace: 20 * ADA },
      changeAddress: env.seller.baseAddress,
      signerKeyHash: env.keyHash(env.seller.baseAddress),
      arbiterKeyHash: env.arbiter.to_public().hash().to_bytes(),
      ttlSlot: env.ttl(),
      params: DEFAULT_PROTOCOL_PARAMS,
    });
    expect(() =>
      assemblePayout({
        unsignedTxHex: payout.txHex,
        walletWitnessSetHex: createTestWallet("fremd").signTx(payout.txHex),
        signerKeyHash: env.keyHash(env.seller.baseAddress),
        arbiter: env.arbiter,
      }),
    ).toThrow(/Schlüssel dieses Handels/);
  });

  it("der Schlichter allein kann nichts auszahlen", async () => {
    const env = setup();
    await deposit(env, 22 * ADA);
    const payout = buildPayoutTx({
      script: env.script,
      utxos: await env.chain.addressUtxos(env.address),
      recipient: { address: env.buyer.baseAddress, lovelace: 20 * ADA },
      changeAddress: env.seller.baseAddress,
      signerKeyHash: env.keyHash(env.seller.baseAddress),
      arbiterKeyHash: env.arbiter.to_public().hash().to_bytes(),
      ttlSlot: env.ttl(),
      params: DEFAULT_PROTOCOL_PARAMS,
    });
    const fixed = CSL.FixedTransaction.from_hex(payout.txHex);
    fixed.sign_and_add_vkey_signature(env.arbiter);
    await expect(env.chain.submit(fixed.to_bytes())).rejects.toThrow(/abgelehnt/);
    expect(env.ledger.balance(env.address)).toBe(22 * ADA);
  });

  it("Notausgang: Verkäufer allein erst nach Ablauf des Zeitschlosses", async () => {
    const env = setup();
    await deposit(env, 22 * ADA);
    const build = () => {
      const tx = CSL.TransactionBuilder.new(
        CSL.TransactionBuilderConfigBuilder.new()
          .fee_algo(CSL.LinearFee.new(CSL.BigNum.from_str("44"), CSL.BigNum.from_str("155381")))
          .coins_per_utxo_byte(CSL.BigNum.from_str("4310"))
          .pool_deposit(CSL.BigNum.from_str("500000000"))
          .key_deposit(CSL.BigNum.from_str("2000000"))
          .max_value_size(5000)
          .max_tx_size(16384)
          .build(),
      );
      const inputs = CSL.TxInputsBuilder.new();
      for (const utxo of env.ledger.utxosAt(env.address)) {
        inputs.add_native_script_input(
          CSL.NativeScriptSource.new(env.script),
          CSL.TransactionInput.new(CSL.TransactionHash.from_hex(utxo.txHash), utxo.index),
          CSL.Value.new(CSL.BigNum.from_str(String(utxo.lovelace))),
        );
      }
      tx.set_inputs(inputs);
      tx.set_validity_start_interval_bignum(CSL.BigNum.from_str(String(env.refundSlot)));
      tx.add_change_if_needed(CSL.Address.from_bech32(env.seller.baseAddress));
      const fixed = CSL.FixedTransaction.from_hex(tx.build_tx().to_hex());
      const witness = CSL.TransactionWitnessSet.from_hex(env.seller.signTx(fixed.to_hex())).vkeys()!.get(0);
      fixed.add_vkey_witness(witness);
      return fixed.to_bytes();
    };
    // Vor Ablauf ist die Transaktion noch nicht gültig
    await expect(env.chain.submit(build())).rejects.toThrow(/abgelehnt/);
    env.setNow(new Date(Date.parse("2026-10-04T12:00:00Z") + 15 * 86_400_000));
    await env.chain.submit(build());
    expect(env.ledger.balance(env.address)).toBe(0);
  });
});
