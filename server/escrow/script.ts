import { createHmac } from "node:crypto";
import * as CSL from "@emurgo/cardano-serialization-lib-nodejs";
import type { CardanoNetwork } from "../../shared/types";

/** Puffer für die Netzwerkgebühr der Auszahlung; der Rest geht an den Verkäufer zurück. */
export const ESCROW_FEE_BUFFER_LOVELACE = 2_000_000;
/** Danach kann der Verkäufer die ADA ohne CardanoMix zurückholen. */
export const ESCROW_REFUND_DAYS = 14;
/** So lange hat der Verkäufer nach dem Start Zeit, die ADA zu hinterlegen. */
export const ESCROW_DEPOSIT_WINDOW_MIN = 60;

/** Slot-Zeitachse ab Shelley (1 Slot = 1 Sekunde). */
const SLOT_CONFIG: Record<CardanoNetwork, { zeroTime: number; zeroSlot: number }> = {
  mainnet: { zeroTime: 1_596_059_091_000, zeroSlot: 4_492_800 },
  preprod: { zeroTime: 1_655_769_600_000, zeroSlot: 86_400 },
};

export function slotAt(network: CardanoNetwork, date: Date): number {
  const config = SLOT_CONFIG[network];
  return Math.floor((date.getTime() - config.zeroTime) / 1000) + config.zeroSlot;
}

export function timeAtSlot(network: CardanoNetwork, slot: number): Date {
  const config = SLOT_CONFIG[network];
  return new Date(config.zeroTime + (slot - config.zeroSlot) * 1000);
}

/**
 * Schlichter-Schlüssel für einen Handel. Er wird aus dem Server-Geheimnis abgeleitet und
 * nirgends gespeichert; jede Handels-ID ergibt einen eigenen Schlüssel und damit eine eigene Adresse.
 */
export function arbiterKey(secret: string, tradeId: string): CSL.PrivateKey {
  const seed = createHmac("sha256", secret).update(`cardanomix-escrow-v1:${tradeId}`).digest();
  return CSL.PrivateKey.from_normal_bytes(new Uint8Array(seed));
}

export interface EscrowTerms {
  sellerKeyHash: Uint8Array;
  buyerKeyHash: Uint8Array;
  arbiterKeyHash: Uint8Array;
  refundSlot: number;
}

const pubkey = (hash: Uint8Array) =>
  CSL.NativeScript.new_script_pubkey(CSL.ScriptPubkey.new(CSL.Ed25519KeyHash.from_bytes(hash)));

/**
 * any [
 *   atLeast 2 [ Verkäufer, Käufer, Schlichter ],
 *   all [ Verkäufer, ab refundSlot ]
 * ]
 */
export function escrowScript(terms: EscrowTerms): CSL.NativeScript {
  const parties = CSL.NativeScripts.new();
  parties.add(pubkey(terms.sellerKeyHash));
  parties.add(pubkey(terms.buyerKeyHash));
  parties.add(pubkey(terms.arbiterKeyHash));
  const twoOfThree = CSL.NativeScript.new_script_n_of_k(CSL.ScriptNOfK.new(2, parties));

  const sellerAfter = CSL.NativeScripts.new();
  sellerAfter.add(pubkey(terms.sellerKeyHash));
  sellerAfter.add(
    CSL.NativeScript.new_timelock_start(CSL.TimelockStart.new_timelockstart(CSL.BigNum.from_str(String(terms.refundSlot)))),
  );
  const refundPath = CSL.NativeScript.new_script_all(CSL.ScriptAll.new(sellerAfter));

  const branches = CSL.NativeScripts.new();
  branches.add(twoOfThree);
  branches.add(refundPath);
  return CSL.NativeScript.new_script_any(CSL.ScriptAny.new(branches));
}

export function escrowAddress(script: CSL.NativeScript, network: CardanoNetwork): string {
  const networkId = network === "mainnet" ? 1 : 0;
  return CSL.EnterpriseAddress.new(networkId, CSL.Credential.from_scripthash(script.hash())).to_address().to_bech32(undefined);
}
