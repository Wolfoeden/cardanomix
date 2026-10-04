import * as CSL from "@emurgo/cardano-serialization-lib-nodejs";
import { z } from "zod";
import { formatAda } from "../../shared/money";
import type { DepositPreview, PayoutPreview, TradeAction } from "../../shared/types";
import { parseAddress } from "../cardano/address";
import type { AppContext } from "../context";
import { badRequest, conflict, HttpError, notFound } from "../http";
import { lockForAction, loadTradeRow, requireAction, roleOf, systemMessage, type TradeRow } from "../trade-store";
import type { UserRow } from "../users";
import { ChainError, koiosChain, type Chain } from "./chain";
import { arbiterKey, slotAt } from "./script";
import { assembleDeposit, assemblePayout, buildDepositTx, buildPayoutTx, EscrowTxError } from "./tx";

/** Mindestabstand zwischen zwei Blockchain-Abfragen pro Handel (außer bei ausdrücklicher Prüfung). */
const SYNC_INTERVAL_MS = 15_000;
/** Danach gilt eine eingereichte, aber unbestätigte Auszahlung als verloren und kann neu ausgelöst werden. */
const PAYOUT_TIMEOUT_MS = 20 * 60_000;
/** Gültigkeit vorbereiteter Transaktionen (Slots = Sekunden) */
const TX_VALIDITY_SLOTS = 2 * 60 * 60;
const MIN_DEPOSIT_LOVELACE = 1_000_000;

const hex = z.string().regex(/^[0-9a-fA-F]+$/, "Erwarte Hex-Daten.");

export const depositTxSchema = z
  .object({ utxos: z.array(hex.max(20_000)).min(1, "Die Wallet hat keine UTxOs geliefert.").max(300), changeAddress: z.string().min(10).max(300) })
  .strict();
export const depositSubmitSchema = z.object({ tx: hex.max(40_000), witnessSet: hex.max(20_000) }).strict();
export const payoutTxSchema = z.object({ kind: z.enum(["release", "refund"]) }).strict();
export const payoutSubmitSchema = z.object({ witnessSet: hex.max(20_000) }).strict();

const chains = new WeakMap<AppContext, Chain>();

export function chainFor(ctx: AppContext): Chain {
  let chain = chains.get(ctx);
  if (!chain) {
    chain = koiosChain({ network: ctx.config.network, token: ctx.config.koiosToken, fetch: ctx.fetch });
    chains.set(ctx, chain);
  }
  return chain;
}

function requireArbiterSecret(ctx: AppContext): string {
  if (!ctx.config.arbiterSecret) {
    throw new HttpError(503, "escrow_not_configured", "Die Treuhand ist noch nicht eingerichtet (ESCROW_ARBITER_SECRET fehlt).");
  }
  return ctx.config.arbiterSecret;
}

function keyHashOf(address: string | null): Uint8Array {
  const parsed = address ? parseAddress(address) : null;
  if (!parsed?.paymentKeyHash) throw new HttpError(500, "escrow_invalid", "Treuhand-Daten des Handels sind unvollständig.");
  return parsed.paymentKeyHash;
}

function toHttp(error: unknown): never {
  if (error instanceof EscrowTxError) throw badRequest(error.message, "escrow_tx");
  if (error instanceof ChainError) throw new HttpError(502, "chain_unavailable", error.message);
  throw error;
}

/**
 * Gleicht die Treuhand mit der Blockchain ab: erkennt Hinterlegungen und bestätigt oder
 * verwirft eingereichte Auszahlungen. Fehler der Blockchain-Abfrage werden geschluckt,
 * außer `force` ist gesetzt.
 */
export async function syncEscrow(ctx: AppContext, tradeId: string, force = false): Promise<void> {
  const trade = await loadTradeRow(ctx.db, tradeId);
  if (!trade?.escrow || !trade.escrow_address) return;
  const status = trade.escrow_status;
  if (status !== "pending" && status !== "releasing" && status !== "refunding") return;
  const checkedAt = trade.escrow_checked_at ? new Date(trade.escrow_checked_at).getTime() : 0;
  if (!force && ctx.now().getTime() - checkedAt < SYNC_INTERVAL_MS) return;
  await ctx.db.query("update trades set escrow_checked_at = $2 where id = $1", [tradeId, ctx.now()]);

  const chain = chainFor(ctx);
  try {
    if (status === "pending") {
      const utxos = await chain.addressUtxos(trade.escrow_address);
      const funded = utxos.filter((utxo) => !utxo.hasAssets).reduce((sum, utxo) => sum + utxo.lovelace, 0);
      const required = Number(trade.escrow_required_lovelace);
      await ctx.db.transaction(async (tx) => {
        const current = await loadTradeRow(tx, tradeId, true);
        if (!current || current.escrow_status !== "pending") return;
        if (funded < required) {
          if (funded !== Number(current.escrow_funded_lovelace ?? 0)) {
            await tx.query("update trades set escrow_funded_lovelace = $2 where id = $1", [tradeId, funded]);
          }
          return;
        }
        if (current.status === "awaiting_escrow") {
          const deadline = new Date(ctx.now().getTime() + (current.payment_window_min ?? 30) * 60_000);
          await tx.query(
            `update trades set status = 'awaiting_payment', escrow_status = 'funded', escrow_funded_lovelace = $2,
               payment_deadline = $3, updated_at = $4 where id = $1`,
            [tradeId, funded, deadline, ctx.now()],
          );
          await systemMessage(
            tx,
            tradeId,
            `Treuhand bestätigt: ${formatAda(funded)} liegen auf der Blockchain in der Treuhand. Käufer: Bitte jetzt zahlen und danach „Ich habe bezahlt“ klicken.`,
          );
        } else {
          // Hinterlegung kam erst nach dem Abbruch an – der Verkäufer kann sie zurückholen.
          await tx.query("update trades set escrow_status = 'funded', escrow_funded_lovelace = $2, updated_at = $3 where id = $1", [
            tradeId,
            funded,
            ctx.now(),
          ]);
          await systemMessage(tx, tradeId, `In der Treuhand sind ${formatAda(funded)} eingegangen. Der Verkäufer kann sie zurückholen.`);
        }
      });
      return;
    }

    // Auszahlung eingereicht: bestätigt oder verloren?
    const confirmations = trade.payout_tx_hash ? await chain.confirmations(trade.payout_tx_hash) : null;
    if (confirmations != null && confirmations > 0) {
      const done = status === "releasing" ? "released" : "refunded";
      const { rows } = await ctx.db.query<{ id: string }>(
        "update trades set escrow_status = $2, updated_at = $3 where id = $1 and escrow_status = $4 returning id",
        [tradeId, done, ctx.now(), status],
      );
      if (rows.length > 0) {
        await systemMessage(
          ctx.db,
          tradeId,
          done === "released"
            ? `Auszahlung auf der Blockchain bestätigt: ${formatAda(Number(trade.lovelace))} sind beim Käufer angekommen.`
            : "Rückzahlung auf der Blockchain bestätigt: Die ADA sind zurück beim Verkäufer.",
        );
      }
      return;
    }
    const submittedAt = trade.payout_submitted_at ? new Date(trade.payout_submitted_at).getTime() : 0;
    if (ctx.now().getTime() - submittedAt > PAYOUT_TIMEOUT_MS) {
      const utxos = await chain.addressUtxos(trade.escrow_address);
      if (utxos.some((utxo) => !utxo.hasAssets)) {
        const { rows } = await ctx.db.query<{ id: string }>(
          `update trades set escrow_status = 'funded', payout_tx_hash = null, payout_kind = null, updated_at = $2
           where id = $1 and escrow_status = $3 returning id`,
          [tradeId, ctx.now(), status],
        );
        if (rows.length > 0) {
          await systemMessage(ctx.db, tradeId, "Die Auszahlung wurde nicht bestätigt. Die ADA liegen weiter in der Treuhand und können erneut ausgelöst werden.");
        }
      }
    }
  } catch (error) {
    if (force) toHttp(error);
    console.error("Treuhand-Abgleich fehlgeschlagen", tradeId, error);
  }
}

/** Baut die Hinterlegung aus den UTxOs der Verkäufer-Wallet. Signieren und Einreichen folgen getrennt. */
export async function prepareDeposit(
  ctx: AppContext,
  viewer: UserRow,
  tradeId: string,
  input: z.infer<typeof depositTxSchema>,
): Promise<DepositPreview> {
  const trade = await loadTradeRow(ctx.db, tradeId);
  if (!trade || !roleOf(ctx, trade, viewer)) throw notFound("Handel nicht gefunden.");
  if (trade.seller_id !== viewer.id) throw conflict("Nur der Verkäufer hinterlegt die ADA.", "invalid_state");
  if (!trade.escrow || trade.status !== "awaiting_escrow" || trade.escrow_status !== "pending") {
    throw conflict("Die Treuhand ist bereits gefüllt oder der Handel ist beendet.", "invalid_state");
  }
  const chain = chainFor(ctx);
  try {
    const utxos = await chain.addressUtxos(trade.escrow_address!);
    const funded = utxos.filter((utxo) => !utxo.hasAssets).reduce((sum, utxo) => sum + utxo.lovelace, 0);
    const missing = Math.max(Number(trade.escrow_required_lovelace) - funded, MIN_DEPOSIT_LOVELACE);
    const built = buildDepositTx({
      walletUtxos: input.utxos,
      changeAddress: input.changeAddress,
      escrowAddress: trade.escrow_address!,
      lovelace: missing,
      ttlSlot: slotAt(ctx.config.network, ctx.now()) + TX_VALIDITY_SLOTS,
      params: await chain.protocolParams(),
    });
    return { txHex: built.txHex, lovelace: missing, fee: built.fee, escrowAddress: trade.escrow_address! };
  } catch (error) {
    toHttp(error);
  }
}

export async function submitDeposit(
  ctx: AppContext,
  viewer: UserRow,
  tradeId: string,
  input: z.infer<typeof depositSubmitSchema>,
): Promise<{ txHash: string }> {
  const trade = await loadTradeRow(ctx.db, tradeId);
  if (!trade || trade.seller_id !== viewer.id || !trade.escrow || trade.status !== "awaiting_escrow") {
    throw conflict("Hinterlegen ist im aktuellen Status nicht möglich.", "invalid_state");
  }
  try {
    const signed = assembleDeposit({
      txHex: input.tx,
      walletWitnessSetHex: input.witnessSet,
      escrowAddress: trade.escrow_address!,
      minLovelace: MIN_DEPOSIT_LOVELACE,
    });
    const txHash = await chainFor(ctx).submit(signed.txBytes);
    await ctx.db.query("update trades set escrow_deposit_tx = $2, updated_at = $3 where id = $1", [tradeId, txHash, ctx.now()]);
    await systemMessage(ctx.db, tradeId, `Der Verkäufer hat die Hinterlegung eingereicht (Tx ${txHash}). Die Bestätigung dauert meist 1–2 Minuten.`);
    return { txHash };
  } catch (error) {
    toHttp(error);
  }
}

/** Wer signiert die Auszahlung zusammen mit dem Schlichter, und welche Aktion erlaubt das? */
function payoutSigner(trade: TradeRow, viewer: UserRow, kind: "release" | "refund"): { action: TradeAction; keyAddress: string | null } {
  if (kind === "refund") return { action: "refund", keyAddress: trade.seller_address };
  if (viewer.id === trade.buyer_id) return { action: "claim", keyAddress: trade.buyer_address };
  return { action: "release", keyAddress: trade.seller_address };
}

/** Baut die Auszahlung aus der Treuhand und merkt sie sich – nur diese signiert der Schlichter später mit. */
export async function preparePayout(
  ctx: AppContext,
  viewer: UserRow,
  tradeId: string,
  kind: "release" | "refund",
): Promise<PayoutPreview> {
  const secret = requireArbiterSecret(ctx);
  const trade = await loadTradeRow(ctx.db, tradeId);
  const role = trade ? roleOf(ctx, trade, viewer) : null;
  if (!trade || !role) throw notFound("Handel nicht gefunden.");
  if (!trade.escrow) throw conflict("Dieser Handel hat keine Treuhand.", "invalid_state");
  const { action, keyAddress } = payoutSigner(trade, viewer, kind);
  requireAction(trade, role, action, ctx.now());

  const chain = chainFor(ctx);
  let preview: PayoutPreview;
  try {
    const recipient = kind === "release" ? { address: trade.buyer_address, lovelace: Number(trade.lovelace) } : null;
    const built = buildPayoutTx({
      script: CSL.NativeScript.from_hex(trade.escrow_script!),
      utxos: await chain.addressUtxos(trade.escrow_address!),
      recipient,
      changeAddress: trade.seller_address!,
      signerKeyHash: keyHashOf(keyAddress),
      arbiterKeyHash: arbiterKey(secret, trade.id).to_public().hash().to_bytes(),
      ttlSlot: slotAt(ctx.config.network, ctx.now()) + TX_VALIDITY_SLOTS,
      params: await chain.protocolParams(),
    });
    preview = {
      kind,
      txHex: built.txHex,
      toAddress: recipient?.address ?? null,
      toLovelace: built.recipientLovelace,
      changeAddress: trade.seller_address!,
      changeLovelace: built.changeLovelace,
      fee: built.fee,
    };
  } catch (error) {
    toHttp(error);
  }
  await ctx.db.query(
    "update trades set pending_payout_tx = $2, pending_payout_kind = $3, pending_payout_signer = $4 where id = $1",
    [tradeId, preview.txHex, kind, viewer.id],
  );
  return preview;
}

/** Prüft die Wallet-Signatur, signiert als Schlichter mit und reicht die Auszahlung ein. */
export async function submitPayout(
  ctx: AppContext,
  viewer: UserRow,
  tradeId: string,
  input: z.infer<typeof payoutSubmitSchema>,
): Promise<{ txHash: string }> {
  const secret = requireArbiterSecret(ctx);

  const prepared = await ctx.db.transaction(async (tx) => {
    const { trade, role } = await lockForAction(tx, ctx, tradeId, viewer);
    if (!trade.escrow || !trade.pending_payout_tx || !trade.pending_payout_kind || trade.pending_payout_signer !== viewer.id) {
      throw conflict("Keine vorbereitete Auszahlung gefunden. Bitte erneut auslösen.", "no_pending_payout");
    }
    const kind = trade.pending_payout_kind;
    const { action, keyAddress } = payoutSigner(trade, viewer, kind);
    requireAction(trade, role, action, ctx.now());
    let signed: { txBytes: Uint8Array; txHash: string };
    try {
      signed = assemblePayout({
        unsignedTxHex: trade.pending_payout_tx,
        walletWitnessSetHex: input.witnessSet,
        signerKeyHash: keyHashOf(keyAddress),
        arbiter: arbiterKey(secret, trade.id),
      });
    } catch (error) {
      toHttp(error);
    }
    // Erst Zustand festhalten, dann einreichen: Der Tx-Hash steht vorher fest.
    await tx.query(
      `update trades set escrow_status = $2, payout_kind = $3, payout_tx_hash = $4, payout_submitted_at = $5,
         pending_payout_tx = null, pending_payout_kind = null, pending_payout_signer = null, updated_at = $5
       where id = $1`,
      [tradeId, kind === "release" ? "releasing" : "refunding", kind, signed.txHash, ctx.now()],
    );
    return { trade, kind, signed, action };
  });

  try {
    await chainFor(ctx).submit(prepared.signed.txBytes);
  } catch (error) {
    await ctx.db.query(
      `update trades set escrow_status = 'funded', payout_kind = null, payout_tx_hash = null, payout_submitted_at = null
       where id = $1 and payout_tx_hash = $2`,
      [tradeId, prepared.signed.txHash],
    );
    toHttp(error);
  }

  await ctx.db.transaction(async (tx) => {
    const { trade, kind, signed, action } = prepared;
    if (kind === "release" && ["awaiting_payment", "paid", "disputed"].includes(trade.status)) {
      await tx.query(
        `update trades set status = 'completed', completed_at = $2, updated_at = $2, completion_note = 'escrow_release'
         where id = $1`,
        [tradeId, ctx.now()],
      );
    }
    const text =
      action === "release"
        ? `Der Verkäufer hat den Zahlungseingang bestätigt und ${formatAda(Number(trade.lovelace))} aus der Treuhand an den Käufer freigegeben (Tx ${signed.txHash}).`
        : action === "claim"
          ? `Der Käufer hat die ADA nach der Entscheidung der Moderation aus der Treuhand abgeholt (Tx ${signed.txHash}).`
          : `Der Verkäufer hat die ADA aus der Treuhand zurückgeholt (Tx ${signed.txHash}).`;
    await systemMessage(tx, tradeId, text);
  });
  return { txHash: prepared.signed.txHash };
}
