import type { EscrowStatus, Fiat, PaymentMethod, TradeStatus } from "../shared/constants";
import type { Trade, TradeAction } from "../shared/types";
import type { AppContext } from "./context";
import type { Queryable } from "./db";
import { conflict, notFound } from "./http";
import type { UserRow } from "./users";

export interface TradeRow {
  id: string;
  offer_id: string;
  maker_id: string;
  taker_id: string;
  seller_id: string;
  buyer_id: string;
  fiat: Fiat;
  price_micro: unknown;
  lovelace: unknown;
  fiat_cents: unknown;
  payment_method: PaymentMethod;
  buyer_address: string;
  status: TradeStatus;
  payment_deadline: Date | string;
  payment_window_min: number | null;
  tx_hash: string | null;
  paid_at: Date | string | null;
  completed_at: Date | string | null;
  completion_note: string | null;
  cancelled_at: Date | string | null;
  cancel_reason: string | null;
  cancel_fault_user_id: string | null;
  disputed_at: Date | string | null;
  disputed_by: string | null;
  dispute_reason: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  escrow: boolean;
  seller_address: string | null;
  escrow_address: string | null;
  escrow_script: string | null;
  escrow_refund_slot: unknown;
  escrow_refund_after: Date | string | null;
  escrow_required_lovelace: unknown;
  escrow_funded_lovelace: unknown;
  escrow_status: EscrowStatus | null;
  escrow_deadline: Date | string | null;
  escrow_checked_at: Date | string | null;
  escrow_deposit_tx: string | null;
  payout_kind: "release" | "refund" | null;
  payout_tx_hash: string | null;
  payout_submitted_at: Date | string | null;
  pending_payout_tx: string | null;
  pending_payout_kind: "release" | "refund" | null;
  pending_payout_signer: string | null;
}

export const OPEN_STATUSES: TradeStatus[] = ["awaiting_escrow", "awaiting_payment", "paid", "disputed"];

export async function systemMessage(db: Queryable, tradeId: string, body: string): Promise<void> {
  await db.query("insert into cardanomix.trade_messages (trade_id, sender_id, body) values ($1, null, $2)", [tradeId, body]);
}

export async function loadTradeRow(db: Queryable, id: string, lock = false): Promise<TradeRow | null> {
  const { rows } = await db.query<TradeRow>(`select * from cardanomix.trades where id = $1${lock ? " for update" : ""}`, [id]);
  return rows[0] ?? null;
}

export function roleOf(ctx: AppContext, trade: Pick<TradeRow, "buyer_id" | "seller_id">, viewer: UserRow): Trade["role"] | null {
  if (trade.buyer_id === viewer.id) return "buyer";
  if (trade.seller_id === viewer.id) return "seller";
  if (ctx.config.adminIdentities.has(viewer.identity)) return "admin";
  return null;
}

type ActionTrade = Pick<TradeRow, "status" | "payment_deadline" | "escrow" | "escrow_status" | "completion_note">;

/** Treuhand-Ablauf: Wer darf in welchem Zustand was? */
function escrowActions(trade: ActionTrade, role: Trade["role"], overdue: boolean): TradeAction[] {
  const actions: TradeAction[] = [];
  const funded = trade.escrow_status === "funded";
  if (role === "buyer") {
    if (trade.status === "awaiting_escrow") actions.push("cancel");
    if (trade.status === "awaiting_payment") actions.push("mark_paid", "cancel");
    if (trade.status === "paid") actions.push("dispute");
    if (trade.status === "completed" && funded && trade.completion_note === "admin") actions.push("claim");
  }
  if (role === "seller") {
    if (trade.status === "awaiting_escrow") actions.push("fund_escrow", "cancel");
    if (trade.status === "awaiting_payment") {
      if (funded) actions.push("release");
      if (overdue) actions.push("cancel");
    }
    if (trade.status === "paid") {
      if (funded) actions.push("release");
      actions.push("dispute");
    }
    if ((trade.status === "disputed" || trade.status === "completed") && funded) actions.push("release");
    if (trade.status === "cancelled" && funded) actions.push("refund");
  }
  return actions;
}

/** Alter Ablauf ohne Treuhand (Trades vor Einführung der Treuhand). */
function legacyActions(trade: ActionTrade, role: Trade["role"], overdue: boolean): TradeAction[] {
  const actions: TradeAction[] = [];
  if (role === "buyer") {
    if (trade.status === "awaiting_payment") actions.push("mark_paid", "cancel");
    if (trade.status === "paid") actions.push("confirm_receipt", "dispute");
    if (trade.status === "disputed") actions.push("confirm_receipt");
  }
  if (role === "seller") {
    if (trade.status === "awaiting_payment" && overdue) actions.push("cancel");
    if (trade.status === "paid") actions.push("release", "dispute");
    if (trade.status === "disputed") actions.push("release");
  }
  return actions;
}

export function allowedActions(trade: ActionTrade, role: Trade["role"], now: Date, hasRated: boolean): TradeAction[] {
  const overdue = now.getTime() > new Date(trade.payment_deadline).getTime();
  const actions = trade.escrow ? escrowActions(trade, role, overdue) : legacyActions(trade, role, overdue);
  if (role === "admin" && trade.status === "disputed") actions.push("resolve");
  if ((role === "buyer" || role === "seller") && trade.status === "completed" && !hasRated) actions.push("rate");
  return actions;
}

export function requireAction(trade: TradeRow, role: Trade["role"], action: TradeAction, now: Date): void {
  if (!allowedActions(trade, role, now, true).includes(action)) {
    throw conflict("Diese Aktion ist im aktuellen Status nicht möglich.", "invalid_state");
  }
}

/** Lädt und sperrt einen Handel und prüft die Rolle des Nutzers. */
export async function lockForAction(tx: Queryable, ctx: AppContext, tradeId: string, viewer: UserRow) {
  const trade = await loadTradeRow(tx, tradeId, true);
  if (!trade) throw notFound("Handel nicht gefunden.");
  const role = roleOf(ctx, trade, viewer);
  if (!role) throw notFound("Handel nicht gefunden.");
  return { trade, role };
}

export async function restoreOffer(tx: Queryable, trade: TradeRow): Promise<void> {
  await tx.query("update cardanomix.offers set available_lovelace = available_lovelace + $2, updated_at = now() where id = $1", [
    trade.offer_id,
    Number(trade.lovelace),
  ]);
}
