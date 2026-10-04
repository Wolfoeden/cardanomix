import { randomBytes } from "node:crypto";
import * as CSL from "@emurgo/cardano-serialization-lib-nodejs";
import type { CardanoNetwork } from "../shared/types";
import { DEFAULT_PROTOCOL_PARAMS } from "../server/escrow/chain";
import { slotAt } from "../server/escrow/script";

interface LedgerUtxo {
  txHash: string;
  index: number;
  address: string;
  lovelace: number;
  /** Rohausgabe für CIP-30 `getUtxos` (TransactionUnspentOutput) */
  outputHex: string;
  hasAssets: boolean;
}

export class LedgerError extends Error {}

/**
 * Simulierte Cardano-Chain für lokale Entwicklung und Tests. Bucht Transaktionen wie der Ledger:
 * Eingänge müssen existieren, Signaturen und Native Scripts erfüllt sein, die Gebühr reichen
 * und die ADA-Bilanz aufgehen. Antwortet auf die Koios-Endpunkte, die der Server nutzt.
 */
export class FakeLedger {
  private utxos = new Map<string, LedgerUtxo>();
  private confirmed = new Map<string, { outputs: { address: string; lovelace: number }[]; timestamp: number }>();
  readonly submitted: string[] = [];

  constructor(
    readonly network: CardanoNetwork = "mainnet",
    private now: () => Date = () => new Date(),
  ) {}

  private add(txHash: string, index: number, output: CSL.TransactionOutput) {
    const address = output.address().to_bech32(undefined);
    const utxo: LedgerUtxo = {
      txHash,
      index,
      address,
      lovelace: Number(output.amount().coin().to_str()),
      outputHex: CSL.TransactionUnspentOutput.new(
        CSL.TransactionInput.new(CSL.TransactionHash.from_hex(txHash), index),
        output,
      ).to_hex(),
      hasAssets: (output.amount().multiasset()?.len() ?? 0) > 0,
    };
    this.utxos.set(`${txHash}#${index}`, utxo);
  }

  /** Legt eine UTxO mit reinen ADA an (z. B. Startguthaben einer Test-Wallet). */
  fund(address: string, lovelace: number): string {
    const txHash = randomBytes(32).toString("hex");
    this.add(txHash, 0, CSL.TransactionOutput.new(CSL.Address.from_bech32(address), CSL.Value.new(CSL.BigNum.from_str(String(lovelace)))));
    this.confirmed.set(txHash, { outputs: [{ address, lovelace }], timestamp: Math.floor(this.now().getTime() / 1000) });
    return txHash;
  }

  utxosAt(address: string): LedgerUtxo[] {
    return [...this.utxos.values()].filter((utxo) => utxo.address === address);
  }

  balance(address: string): number {
    return this.utxosAt(address).reduce((sum, utxo) => sum + utxo.lovelace, 0);
  }

  submit(txBytes: Uint8Array): string {
    const fixed = CSL.FixedTransaction.from_bytes(txBytes);
    const body = fixed.body();
    const txHash = fixed.transaction_hash().to_hex();
    const hashBytes = fixed.transaction_hash().to_bytes();
    const slot = slotAt(this.network, this.now());

    const ttl = body.ttl_bignum();
    if (ttl && Number(ttl.to_str()) < slot) throw new LedgerError("OutsideValidityIntervalUTxO: abgelaufen");
    const start = body.validity_start_interval_bignum();
    if (start && Number(start.to_str()) > slot) throw new LedgerError("OutsideValidityIntervalUTxO: noch nicht gültig");

    const witnesses = fixed.witness_set();
    const signers = new Set<string>();
    const vkeys = witnesses.vkeys();
    for (let i = 0; i < (vkeys?.len() ?? 0); i++) {
      const witness = vkeys!.get(i);
      const key = witness.vkey().public_key();
      if (!key.verify(hashBytes, witness.signature())) throw new LedgerError("InvalidWitnessesUTXOW");
      signers.add(key.hash().to_hex());
    }
    const scripts = new Map<string, CSL.NativeScript>();
    const nativeScripts = witnesses.native_scripts();
    for (let i = 0; i < (nativeScripts?.len() ?? 0); i++) {
      const script = nativeScripts!.get(i);
      scripts.set(script.hash().to_hex(), script);
    }
    const validityStart = start ? Number(start.to_str()) : null;

    const inputs = body.inputs();
    let consumed = 0;
    const spent: string[] = [];
    for (let i = 0; i < inputs.len(); i++) {
      const input = inputs.get(i);
      const key = `${input.transaction_id().to_hex()}#${input.index()}`;
      const utxo = this.utxos.get(key);
      if (!utxo) throw new LedgerError(`BadInputsUTxO: ${key}`);
      const credential = CSL.Address.from_bech32(utxo.address).payment_cred();
      const keyHash = credential?.to_keyhash()?.to_hex();
      const scriptHash = credential?.to_scripthash()?.to_hex();
      if (keyHash && !signers.has(keyHash)) throw new LedgerError(`MissingVKeyWitnessesUTXOW: ${keyHash}`);
      if (scriptHash) {
        const script = scripts.get(scriptHash);
        if (!script) throw new LedgerError(`MissingScriptWitnessesUTXOW: ${scriptHash}`);
        if (!satisfied(script, signers, validityStart)) throw new LedgerError("ScriptWitnessNotValidatingUTXOW");
      }
      consumed += utxo.lovelace;
      spent.push(key);
    }
    const required = body.required_signers();
    for (let i = 0; i < (required?.len() ?? 0); i++) {
      const hash = required!.get(i).to_hex();
      if (!signers.has(hash)) throw new LedgerError(`MissingVKeyWitnessesUTXOW (required): ${hash}`);
    }

    const outputs = body.outputs();
    let produced = 0;
    const recorded: { address: string; lovelace: number }[] = [];
    for (let i = 0; i < outputs.len(); i++) {
      const output = outputs.get(i);
      const lovelace = Number(output.amount().coin().to_str());
      const minAda = Number(
        CSL.min_ada_for_output(output, CSL.DataCost.new_coins_per_byte(CSL.BigNum.from_str(String(DEFAULT_PROTOCOL_PARAMS.coinsPerUtxoByte)))).to_str(),
      );
      if (lovelace < minAda) throw new LedgerError("BabbageOutputTooSmallUTxO");
      produced += lovelace;
      recorded.push({ address: output.address().to_bech32(undefined), lovelace });
    }
    const fee = Number(body.fee().to_str());
    const tx = CSL.Transaction.from_bytes(txBytes);
    const minFee = Number(
      CSL.min_fee(
        tx,
        CSL.LinearFee.new(
          CSL.BigNum.from_str(String(DEFAULT_PROTOCOL_PARAMS.minFeeA)),
          CSL.BigNum.from_str(String(DEFAULT_PROTOCOL_PARAMS.minFeeB)),
        ),
      ).to_str(),
    );
    if (fee < minFee) throw new LedgerError(`FeeTooSmallUTxO: ${fee} < ${minFee}`);
    if (consumed !== produced + fee) throw new LedgerError(`ValueNotConservedUTxO: ${consumed} ≠ ${produced} + ${fee}`);

    for (const key of spent) this.utxos.delete(key);
    for (let i = 0; i < outputs.len(); i++) this.add(txHash, i, outputs.get(i));
    this.confirmed.set(txHash, { outputs: recorded, timestamp: Math.floor(this.now().getTime() / 1000) });
    this.submitted.push(txHash);
    return txHash;
  }

  /** Koios-kompatible Antworten für den Server (`ctx.fetch`). */
  fetch: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url).pathname.replace(/^\/api\/v1/, "");
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    const body = () => JSON.parse(String(init?.body ?? "{}")) as Record<string, string[]>;

    switch (path) {
      case "/address_utxos":
        return json(
          (body()._addresses ?? []).flatMap((address) =>
            this.utxosAt(address).map((utxo) => ({
              tx_hash: utxo.txHash,
              tx_index: utxo.index,
              value: String(utxo.lovelace),
              asset_list: utxo.hasAssets ? [{}] : [],
            })),
          ),
        );
      case "/cli_protocol_params":
        return json({
          txFeePerByte: DEFAULT_PROTOCOL_PARAMS.minFeeA,
          txFeeFixed: DEFAULT_PROTOCOL_PARAMS.minFeeB,
          utxoCostPerByte: DEFAULT_PROTOCOL_PARAMS.coinsPerUtxoByte,
        });
      case "/submittx":
        try {
          return json(this.submit(new Uint8Array(init?.body as ArrayBuffer | Uint8Array)), 202);
        } catch (error) {
          return new Response(error instanceof Error ? error.message : String(error), { status: 400 });
        }
      case "/tx_status":
        return json(
          (body()._tx_hashes ?? []).map((hash) => ({ tx_hash: hash, num_confirmations: this.confirmed.has(hash) ? 1 : null })),
        );
      case "/tx_info":
        return json(
          (body()._tx_hashes ?? []).flatMap((hash) => {
            const tx = this.confirmed.get(hash);
            return tx
              ? [
                  {
                    tx_hash: hash,
                    block_height: 1,
                    tx_timestamp: tx.timestamp,
                    outputs: tx.outputs.map((output) => ({ payment_addr: { bech32: output.address }, value: String(output.lovelace) })),
                  },
                ]
              : [];
          }),
        );
      default:
        return json({ error: "unbekannter Endpunkt" }, 404);
    }
  };
}

function satisfied(script: CSL.NativeScript, signers: Set<string>, validityStart: number | null): boolean {
  switch (script.kind()) {
    case CSL.NativeScriptKind.ScriptPubkey:
      return signers.has(script.as_script_pubkey()!.addr_keyhash().to_hex());
    case CSL.NativeScriptKind.ScriptAll: {
      const list = script.as_script_all()!.native_scripts();
      for (let i = 0; i < list.len(); i++) if (!satisfied(list.get(i), signers, validityStart)) return false;
      return true;
    }
    case CSL.NativeScriptKind.ScriptAny: {
      const list = script.as_script_any()!.native_scripts();
      for (let i = 0; i < list.len(); i++) if (satisfied(list.get(i), signers, validityStart)) return true;
      return false;
    }
    case CSL.NativeScriptKind.ScriptNOfK: {
      const nOfK = script.as_script_n_of_k()!;
      const list = nOfK.native_scripts();
      let count = 0;
      for (let i = 0; i < list.len(); i++) if (satisfied(list.get(i), signers, validityStart)) count++;
      return count >= nOfK.n();
    }
    case CSL.NativeScriptKind.TimelockStart:
      return validityStart != null && validityStart >= Number(script.as_timelock_start()!.slot_bignum().to_str());
    default:
      return false;
  }
}
