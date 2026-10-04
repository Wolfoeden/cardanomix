import * as CSL from "@emurgo/cardano-serialization-lib-nodejs";
import type { ChainUtxo, ProtocolParams } from "./chain";

export class EscrowTxError extends Error {}

const big = (value: number | string) => CSL.BigNum.from_str(String(value));

function txBuilder(params: ProtocolParams): CSL.TransactionBuilder {
  const config = CSL.TransactionBuilderConfigBuilder.new()
    .fee_algo(CSL.LinearFee.new(big(params.minFeeA), big(params.minFeeB)))
    .coins_per_utxo_byte(big(params.coinsPerUtxoByte))
    .pool_deposit(big(params.poolDeposit))
    .key_deposit(big(params.keyDeposit))
    .max_value_size(params.maxValueSize)
    .max_tx_size(params.maxTxSize)
    // Wird nur für Plutus gebraucht, der Builder verlangt den Wert trotzdem.
    .ex_unit_prices(
      CSL.ExUnitPrices.new(CSL.UnitInterval.new(big(577), big(10_000)), CSL.UnitInterval.new(big(721), big(10_000_000))),
    )
    .prefer_pure_change(true)
    .build();
  return CSL.TransactionBuilder.new(config);
}

function buildError(error: unknown): EscrowTxError {
  const text = typeof error === "string" ? error : error instanceof Error ? error.message : String(error);
  if (/insufficient|not enough|UTxO Balance/i.test(text)) {
    return new EscrowTxError("Nicht genug ADA für Betrag und Netzwerkgebühr.");
  }
  return new EscrowTxError(`Transaktion konnte nicht gebaut werden: ${text}`);
}

export interface BuiltTx {
  txHex: string;
  txHash: string;
  fee: number;
}

function finish(tx: CSL.Transaction): BuiltTx {
  const txHex = tx.to_hex();
  return {
    txHex,
    txHash: CSL.FixedTransaction.from_hex(txHex).transaction_hash().to_hex(),
    fee: Number(tx.body().fee().to_str()),
  };
}

/** Hinterlegung: Wallet-UTxOs (CIP-30 `getUtxos`) → Treuhand-Adresse, Wechselgeld zurück an die Wallet. */
export function buildDepositTx(input: {
  walletUtxos: string[];
  changeAddress: string;
  escrowAddress: string;
  lovelace: number;
  ttlSlot: number;
  params: ProtocolParams;
}): BuiltTx {
  try {
    const utxos = CSL.TransactionUnspentOutputs.new();
    for (const hex of input.walletUtxos) utxos.add(CSL.TransactionUnspentOutput.from_hex(hex));
    const builder = txBuilder(input.params);
    builder.add_output(
      CSL.TransactionOutput.new(CSL.Address.from_bech32(input.escrowAddress), CSL.Value.new(big(input.lovelace))),
    );
    builder.add_inputs_from(utxos, CSL.CoinSelectionStrategyCIP2.LargestFirstMultiAsset);
    builder.set_ttl_bignum(big(input.ttlSlot));
    builder.add_change_if_needed(parseAddress(input.changeAddress));
    return finish(builder.build_tx());
  } catch (error) {
    throw buildError(error);
  }
}

export interface PayoutTx extends BuiltTx {
  recipientLovelace: number;
  changeLovelace: number;
}

/**
 * Auszahlung aus der Treuhand. Mit `recipient` geht genau dieser Betrag dorthin, der Rest an
 * `changeAddress`; ohne `recipient` (Rückzahlung) geht alles an `changeAddress`.
 * `signerKeyHash` ist der Schlüssel der Partei, die zusammen mit dem Schlichter signiert.
 */
export function buildPayoutTx(input: {
  script: CSL.NativeScript;
  utxos: ChainUtxo[];
  recipient: { address: string; lovelace: number } | null;
  changeAddress: string;
  signerKeyHash: Uint8Array;
  arbiterKeyHash: Uint8Array;
  ttlSlot: number;
  params: ProtocolParams;
}): PayoutTx {
  const spendable = input.utxos.filter((utxo) => !utxo.hasAssets);
  if (spendable.length === 0) throw new EscrowTxError("In der Treuhand liegen keine ADA.");
  try {
    const signers = CSL.Ed25519KeyHashes.new();
    signers.add(CSL.Ed25519KeyHash.from_bytes(input.signerKeyHash));
    signers.add(CSL.Ed25519KeyHash.from_bytes(input.arbiterKeyHash));
    const inputs = CSL.TxInputsBuilder.new();
    for (const utxo of spendable) {
      const source = CSL.NativeScriptSource.new(input.script);
      source.set_required_signers(signers);
      inputs.add_native_script_input(
        source,
        CSL.TransactionInput.new(CSL.TransactionHash.from_hex(utxo.txHash), utxo.index),
        CSL.Value.new(big(utxo.lovelace)),
      );
    }
    const builder = txBuilder(input.params);
    builder.set_inputs(inputs);
    if (input.recipient) {
      builder.add_output(
        CSL.TransactionOutput.new(CSL.Address.from_bech32(input.recipient.address), CSL.Value.new(big(input.recipient.lovelace))),
      );
    }
    builder.add_required_signer(CSL.Ed25519KeyHash.from_bytes(input.signerKeyHash));
    builder.set_ttl_bignum(big(input.ttlSlot));
    builder.add_change_if_needed(CSL.Address.from_bech32(input.changeAddress));
    const tx = builder.build_tx();
    const outputs = tx.body().outputs();
    let changeLovelace = 0;
    for (let i = 0; i < outputs.len(); i++) {
      const output = outputs.get(i);
      if (output.address().to_bech32(undefined) === input.changeAddress) changeLovelace += Number(output.amount().coin().to_str());
    }
    return { ...finish(tx), recipientLovelace: input.recipient?.lovelace ?? 0, changeLovelace };
  } catch (error) {
    if (error instanceof EscrowTxError) throw error;
    throw buildError(error);
  }
}

function parseAddress(value: string): CSL.Address {
  return /^[0-9a-fA-F]+$/.test(value) ? CSL.Address.from_hex(value) : CSL.Address.from_bech32(value);
}

/** Prüft Wallet-Signaturen gegen den Tx-Hash und gibt die gültigen Zeugen samt Schlüssel-Hash zurück. */
function validWitnesses(fixed: CSL.FixedTransaction, witnessSetHex: string): { witness: CSL.Vkeywitness; keyHash: string }[] {
  let witnessSet: CSL.TransactionWitnessSet;
  try {
    witnessSet = CSL.TransactionWitnessSet.from_hex(witnessSetHex);
  } catch {
    throw new EscrowTxError("Die Wallet hat keine gültige Signatur geliefert.");
  }
  const hash = fixed.transaction_hash().to_bytes();
  const vkeys = witnessSet.vkeys();
  const result: { witness: CSL.Vkeywitness; keyHash: string }[] = [];
  for (let i = 0; i < (vkeys?.len() ?? 0); i++) {
    const witness = vkeys!.get(i);
    const publicKey = witness.vkey().public_key();
    if (publicKey.verify(hash, witness.signature())) result.push({ witness, keyHash: publicKey.hash().to_hex() });
  }
  return result;
}

/** Fügt die Signatur der Partei und die des Schlichters hinzu. Nur Transaktionen, die der Server gebaut hat. */
export function assemblePayout(input: {
  unsignedTxHex: string;
  walletWitnessSetHex: string;
  signerKeyHash: Uint8Array;
  arbiter: CSL.PrivateKey;
}): { txBytes: Uint8Array; txHash: string } {
  const fixed = CSL.FixedTransaction.from_hex(input.unsignedTxHex);
  const expected = Buffer.from(input.signerKeyHash).toString("hex");
  const own = validWitnesses(fixed, input.walletWitnessSetHex).find((item) => item.keyHash === expected);
  if (!own) {
    throw new EscrowTxError("Die Signatur stammt nicht vom Schlüssel dieses Handels. Ist die richtige Wallet verbunden?");
  }
  fixed.add_vkey_witness(own.witness);
  fixed.sign_and_add_vkey_signature(input.arbiter);
  return { txBytes: fixed.to_bytes(), txHash: fixed.transaction_hash().to_hex() };
}

/** Fügt die Wallet-Signaturen zur Hinterlegung hinzu und prüft, dass sie wirklich an die Treuhand zahlt. */
export function assembleDeposit(input: {
  txHex: string;
  walletWitnessSetHex: string;
  escrowAddress: string;
  minLovelace: number;
}): { txBytes: Uint8Array; txHash: string } {
  let fixed: CSL.FixedTransaction;
  try {
    fixed = CSL.FixedTransaction.from_hex(input.txHex);
  } catch {
    throw new EscrowTxError("Ungültige Transaktion.");
  }
  const outputs = fixed.body().outputs();
  let paid = 0;
  for (let i = 0; i < outputs.len(); i++) {
    const output = outputs.get(i);
    if (output.address().to_bech32(undefined) === input.escrowAddress) paid += Number(output.amount().coin().to_str());
  }
  if (paid < input.minLovelace) throw new EscrowTxError("Die Transaktion zahlt nicht den vereinbarten Betrag in die Treuhand.");
  const witnesses = validWitnesses(fixed, input.walletWitnessSetHex);
  if (witnesses.length === 0) throw new EscrowTxError("Die Wallet hat keine gültige Signatur geliefert.");
  for (const { witness } of witnesses) fixed.add_vkey_witness(witness);
  return { txBytes: fixed.to_bytes(), txHash: fixed.transaction_hash().to_hex() };
}
