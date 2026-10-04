import { z } from "zod";
import {
  AUTO_CANCEL_GRACE_MIN,
  MAX_OPEN_TRADES_PER_TAKER,
  MIN_TRADE_LOVELACE,
  NEW_USER_MAX_FIAT_CENTS,
  NEW_USER_TRADE_THRESHOLD,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABEL,
  type Fiat,
  type PaymentMethod,
  type TradeStatus,
} from "../shared/constants";
import { fiatCentsFor, formatAda, formatFiat, lovelaceFor, parseAdaToLovelace, parseFiatToCents } from "../shared/money";
import type {
  DisputeSummary,
  Rating,
  ReleaseResponse,
  Trade,
  TradeAction,
  TradeDetailResponse,
  TradeMessage,
  TradeSummary,
} from "../shared/types";
import { checkPayment } from "./cardano/koios";
import { isUniqueViolation, toIso, toIsoOrNull, type AppContext } from "./context";
import type { Queryable } from "./db";
import { badRequest, conflict, forbidden, HttpError, notFound } from "./http";
import { loadOfferRow, priceFor } from "./offers";
import { completedTradeCount, type UserRow } from "./users";

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
}

interface TradeDetailRow extends TradeRow {
  buyer_name: string;
  seller_name: string;
  terms: string;
}

const OPEN_STATUSES: TradeStatus[] = ["awaiting_payment", "paid", "disputed"];

export const startTradeSchema = z
  .object({
    amountType: z.enum(["fiat", "ada"]),
    amount: z.string().min(1).max(20),
    paymentMethod: z.enum(PAYMENT_METHODS),
  })
  .strict();

export const releaseSchema = z
  .object({ txHash: z.string().trim().toLowerCase().regex(/^[0-9a-f]{64}$/, "Ein Tx-Hash hat 64 Hex-Zeichen.") })
  .strict();

export const disputeSchema = z
  .object({ reason: z.string().trim().min(10, "Bitte den Streitfall kurz beschreiben (mind. 10 Zeichen).").max(1000) })
  .strict();

export const messageSchema = z.object({ body: z.string().trim().min(1, "Nachricht ist leer.").max(2000) }).strict();

export const rateSchema = z
  .object({ positive: z.boolean(), comment: z.string().trim().max(500).default("") })
  .strict();

export const resolveSchema = z
  .object({
    outcome: z.enum(["completed", "cancelled"]),
    fault: z.enum(["buyer", "seller", "none"]),
    note: z.string().trim().min(5, "Bitte die Entscheidung kurz begründen.").max(1000),
    banFaultUser: z.boolean().default(false),
  })
  .strict();

async function systemMessage(db: Queryable, tradeId: string, body: string): Promise<void> {
  await db.query("insert into trade_messages (trade_id, sender_id, body) values ($1, null, $2)", [tradeId, body]);
}

async function loadTradeRow(db: Queryable, id: string, lock = false): Promise<TradeRow | null> {
  const { rows } = await db.query<TradeRow>(`select * from trades where id = $1${lock ? " for update" : ""}`, [id]);
  return rows[0] ?? null;
}

function roleOf(ctx: AppContext, trade: Pick<TradeRow, "buyer_id" | "seller_id">, viewer: UserRow): Trade["role"] | null {
  if (trade.buyer_id === viewer.id) return "buyer";
  if (trade.seller_id === viewer.id) return "seller";
  if (ctx.config.adminIdentities.has(viewer.identity)) return "admin";
  return null;
}

export function allowedActions(
  trade: Pick<TradeRow, "status" | "payment_deadline">,
  role: Trade["role"],
  now: Date,
  hasRated: boolean,
): TradeAction[] {
  const actions: TradeAction[] = [];
  const overdue = now.getTime() > new Date(trade.payment_deadline).getTime();
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
  if (role === "admin" && trade.status === "disputed") actions.push("resolve");
  if ((role === "buyer" || role === "seller") && trade.status === "completed" && !hasRated) actions.push("rate");
  return actions;
}

async function loadRatings(db: Queryable, tradeId: string): Promise<(Rating & { raterId: string })[]> {
  const { rows } = await db.query<{
    rater_id: string;
    rater_name: string;
    positive: boolean;
    comment: string;
    created_at: Date | string;
  }>(
    `select r.rater_id, u.display_name as rater_name, r.positive, r.comment, r.created_at
     from ratings r join users u on u.id = r.rater_id
     where r.trade_id = $1 order by r.created_at`,
    [tradeId],
  );
  return rows.map((row) => ({
    raterId: row.rater_id,
    positive: row.positive,
    comment: row.comment,
    createdAt: toIso(row.created_at),
    rater: { id: row.rater_id, displayName: row.rater_name },
  }));
}

async function buildTrade(ctx: AppContext, id: string, viewer: UserRow): Promise<Trade> {
  const { rows } = await ctx.db.query<TradeDetailRow>(
    `select t.*, b.display_name as buyer_name, s.display_name as seller_name, o.terms
     from trades t
       join users b on b.id = t.buyer_id
       join users s on s.id = t.seller_id
       join offers o on o.id = t.offer_id
     where t.id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) throw notFound("Handel nicht gefunden.");
  const role = roleOf(ctx, row, viewer);
  if (!role) throw notFound("Handel nicht gefunden.");
  const ratings = await loadRatings(ctx.db, id);
  const hasRated = ratings.some((rating) => rating.raterId === viewer.id);
  return {
    id: row.id,
    offerId: row.offer_id,
    status: row.status,
    fiat: row.fiat,
    priceMicro: Number(row.price_micro),
    lovelace: Number(row.lovelace),
    fiatCents: Number(row.fiat_cents),
    paymentMethod: row.payment_method,
    buyerAddress: row.buyer_address,
    paymentDeadline: toIso(row.payment_deadline),
    txHash: row.tx_hash,
    paidAt: toIsoOrNull(row.paid_at),
    completedAt: toIsoOrNull(row.completed_at),
    completionNote: row.completion_note,
    cancelledAt: toIsoOrNull(row.cancelled_at),
    cancelReason: row.cancel_reason,
    disputedAt: toIsoOrNull(row.disputed_at),
    disputeReason: row.dispute_reason,
    createdAt: toIso(row.created_at),
    buyer: { id: row.buyer_id, displayName: row.buyer_name },
    seller: { id: row.seller_id, displayName: row.seller_name },
    makerId: row.maker_id,
    terms: row.terms,
    role,
    actions: allowedActions(row, role, ctx.now(), hasRated),
    ratings: ratings.map(({ raterId: _raterId, ...rating }) => rating),
  };
}

async function loadMessages(db: Queryable, tradeId: string, afterId: number): Promise<TradeMessage[]> {
  const { rows } = await db.query<{ id: unknown; sender_id: string | null; body: string; created_at: Date | string }>(
    "select id, sender_id, body, created_at from trade_messages where trade_id = $1 and id > $2 order by id limit 500",
    [tradeId, afterId],
  );
  return rows.map((row) => ({
    id: Number(row.id),
    senderId: row.sender_id,
    body: row.body,
    createdAt: toIso(row.created_at),
  }));
}

export async function getTradeDetail(
  ctx: AppContext,
  viewer: UserRow,
  tradeId: string,
  afterMessageId = 0,
): Promise<TradeDetailResponse> {
  const trade = await buildTrade(ctx, tradeId, viewer);
  return { trade, messages: await loadMessages(ctx.db, tradeId, afterMessageId) };
}

/** Startet einen Handel auf ein Angebot und reserviert die ADA-Menge im Angebot. */
export async function startTrade(
  ctx: AppContext,
  taker: UserRow,
  offerId: string,
  input: z.infer<typeof startTradeSchema>,
): Promise<string> {
  return ctx.db.transaction(async (tx) => {
    // Nutzerzeile sperren, damit parallele Starts das Limit offener Trades nicht umgehen.
    await tx.query("select id from users where id = $1 for update", [taker.id]);
    const offer = await loadOfferRow(tx, offerId, true);
    if (!offer || offer.status === "closed") throw notFound("Angebot nicht gefunden.");
    if (offer.status !== "active") throw conflict("Dieses Angebot ist pausiert.", "offer_paused");
    if (offer.user_id === taker.id) throw badRequest("Eigene Angebote können nicht gehandelt werden.", "own_offer");
    if (!offer.payment_methods.includes(input.paymentMethod)) throw badRequest("Diese Zahlungsart bietet der Anbieter nicht an.");

    const { rows: makers } = await tx.query<UserRow>("select * from users where id = $1", [offer.user_id]);
    const maker = makers[0];
    if (!maker || maker.is_banned) throw conflict("Dieses Angebot ist nicht mehr verfügbar.", "offer_unavailable");

    const { rows: open } = await tx.query<{ count: unknown }>(
      "select count(*) as count from trades where taker_id = $1 and status = any($2::text[])",
      [taker.id, OPEN_STATUSES],
    );
    if (Number(open[0]?.count ?? 0) >= MAX_OPEN_TRADES_PER_TAKER) {
      throw conflict(`Höchstens ${MAX_OPEN_TRADES_PER_TAKER} offene Trades gleichzeitig. Bitte erst laufende abschließen.`, "too_many_trades");
    }

    const priceMicro = priceFor(offer, offer.price_type === "margin" ? await ctx.prices.marketPriceMicro(offer.fiat) : null);
    if (priceMicro == null) {
      throw new HttpError(503, "price_unavailable", "Marktpreis gerade nicht verfügbar. Bitte gleich erneut versuchen.");
    }

    let lovelace: number;
    let fiatCents: number;
    if (input.amountType === "fiat") {
      const cents = parseFiatToCents(input.amount);
      if (cents == null || cents <= 0) throw badRequest("Bitte einen gültigen Betrag eingeben.");
      fiatCents = cents;
      lovelace = lovelaceFor(cents, priceMicro);
    } else {
      const amount = parseAdaToLovelace(input.amount);
      if (amount == null || amount <= 0) throw badRequest("Bitte eine gültige ADA-Menge eingeben.");
      lovelace = amount;
      fiatCents = fiatCentsFor(amount, priceMicro);
    }

    const minCents = Number(offer.min_fiat_cents);
    const maxCents = Number(offer.max_fiat_cents);
    const available = Number(offer.available_lovelace);
    if (lovelace < MIN_TRADE_LOVELACE) throw badRequest("Mindestens 2 ADA pro Handel.");
    if (fiatCents < minCents) throw badRequest(`Mindestbetrag dieses Angebots: ${formatFiat(minCents, offer.fiat)}.`);
    if (fiatCents > maxCents) throw badRequest(`Höchstbetrag dieses Angebots: ${formatFiat(maxCents, offer.fiat)}.`);
    if (lovelace > available) throw conflict(`Im Angebot sind nur noch ${formatAda(available)} verfügbar.`, "insufficient_amount");

    const [takerCompleted, makerCompleted] = await Promise.all([
      completedTradeCount(tx, taker.id),
      completedTradeCount(tx, maker.id),
    ]);
    if (Math.min(takerCompleted, makerCompleted) < NEW_USER_TRADE_THRESHOLD && fiatCents > NEW_USER_MAX_FIAT_CENTS) {
      throw badRequest(
        `Solange eine Seite weniger als ${NEW_USER_TRADE_THRESHOLD} abgeschlossene Trades hat, gilt ein Limit von ${formatFiat(NEW_USER_MAX_FIAT_CENTS, offer.fiat)} pro Handel.`,
        "new_user_limit",
      );
    }

    const makerSells = offer.side === "sell";
    const seller = makerSells ? maker : taker;
    const buyer = makerSells ? taker : maker;
    const deadline = new Date(ctx.now().getTime() + offer.payment_window_min * 60_000);

    await tx.query("update offers set available_lovelace = available_lovelace - $2, updated_at = now() where id = $1", [
      offer.id,
      lovelace,
    ]);
    const { rows } = await tx.query<{ id: string }>(
      `insert into trades (offer_id, maker_id, taker_id, seller_id, buyer_id, fiat, price_micro, lovelace, fiat_cents,
         payment_method, buyer_address, status, payment_deadline, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'awaiting_payment', $12, $13, $13)
       returning id`,
      [
        offer.id,
        maker.id,
        taker.id,
        seller.id,
        buyer.id,
        offer.fiat,
        priceMicro,
        lovelace,
        fiatCents,
        input.paymentMethod,
        buyer.receive_address,
        deadline,
        ctx.now(),
      ],
    );
    const tradeId = rows[0].id;
    await systemMessage(
      tx,
      tradeId,
      `Handel gestartet: ${formatAda(lovelace)} für ${formatFiat(fiatCents, offer.fiat)} per ${PAYMENT_METHOD_LABEL[input.paymentMethod]}. ` +
        `${buyer.display_name} zahlt innerhalb von ${offer.payment_window_min} Minuten und markiert die Zahlung danach als erledigt.`,
    );
    return tradeId;
  });
}

/** Lädt und sperrt einen Handel und prüft die Rolle des Nutzers. */
async function lockForAction(tx: Queryable, ctx: AppContext, tradeId: string, viewer: UserRow) {
  const trade = await loadTradeRow(tx, tradeId, true);
  if (!trade) throw notFound("Handel nicht gefunden.");
  const role = roleOf(ctx, trade, viewer);
  if (!role) throw notFound("Handel nicht gefunden.");
  return { trade, role };
}

function requireAction(trade: TradeRow, role: Trade["role"], action: TradeAction, now: Date): void {
  if (!allowedActions(trade, role, now, true).includes(action)) {
    throw conflict("Diese Aktion ist im aktuellen Status nicht möglich.", "invalid_state");
  }
}

async function restoreOffer(tx: Queryable, trade: TradeRow): Promise<void> {
  await tx.query("update offers set available_lovelace = available_lovelace + $2, updated_at = now() where id = $1", [
    trade.offer_id,
    Number(trade.lovelace),
  ]);
}

export async function markPaid(ctx: AppContext, viewer: UserRow, tradeId: string): Promise<void> {
  await ctx.db.transaction(async (tx) => {
    const { trade, role } = await lockForAction(tx, ctx, tradeId, viewer);
    requireAction(trade, role, "mark_paid", ctx.now());
    await tx.query("update trades set status = 'paid', paid_at = $2, updated_at = $2 where id = $1", [tradeId, ctx.now()]);
    await systemMessage(
      tx,
      tradeId,
      "Der Käufer hat die Zahlung als erledigt markiert. Verkäufer: Bitte den Zahlungseingang prüfen und erst dann die ADA an die Käuferadresse senden.",
    );
  });
}

export async function cancelTrade(ctx: AppContext, viewer: UserRow, tradeId: string): Promise<void> {
  await ctx.db.transaction(async (tx) => {
    const { trade, role } = await lockForAction(tx, ctx, tradeId, viewer);
    requireAction(trade, role, "cancel", ctx.now());
    const reason = role === "buyer" ? "buyer_cancelled" : "expired";
    await tx.query(
      `update trades set status = 'cancelled', cancelled_at = $2, updated_at = $2, cancel_reason = $3, cancel_fault_user_id = $4
       where id = $1`,
      [tradeId, ctx.now(), reason, trade.buyer_id],
    );
    await restoreOffer(tx, trade);
    await systemMessage(
      tx,
      tradeId,
      role === "buyer"
        ? "Der Käufer hat den Handel abgebrochen."
        : "Der Verkäufer hat den Handel nach Ablauf der Zahlungsfrist abgebrochen.",
    );
  });
}

export async function disputeTrade(ctx: AppContext, viewer: UserRow, tradeId: string, reason: string): Promise<void> {
  await ctx.db.transaction(async (tx) => {
    const { trade, role } = await lockForAction(tx, ctx, tradeId, viewer);
    requireAction(trade, role, "dispute", ctx.now());
    await tx.query(
      `update trades set status = 'disputed', disputed_at = $2, updated_at = $2, disputed_by = $3, dispute_reason = $4
       where id = $1`,
      [tradeId, ctx.now(), viewer.id, reason],
    );
    await systemMessage(
      tx,
      tradeId,
      `${role === "buyer" ? "Der Käufer" : "Der Verkäufer"} hat einen Streitfall eröffnet. Die Moderation sieht sich den Handel an. Bitte Belege (z. B. Zahlungsnachweis) hier im Chat bereitstellen.`,
    );
  });
}

export async function confirmReceipt(ctx: AppContext, viewer: UserRow, tradeId: string): Promise<void> {
  await ctx.db.transaction(async (tx) => {
    const { trade, role } = await lockForAction(tx, ctx, tradeId, viewer);
    requireAction(trade, role, "confirm_receipt", ctx.now());
    await tx.query(
      `update trades set status = 'completed', completed_at = $2, updated_at = $2, completion_note = 'buyer_confirmed'
       where id = $1`,
      [tradeId, ctx.now()],
    );
    await systemMessage(tx, tradeId, "Der Käufer hat den Erhalt der ADA bestätigt. Der Handel ist abgeschlossen.");
  });
}

/**
 * Verkäufer meldet die ADA-Transaktion. Der Hash wird gespeichert und über Koios geprüft;
 * ist die Zahlung bestätigt, wird der Handel abgeschlossen.
 */
export async function releaseTrade(ctx: AppContext, viewer: UserRow, tradeId: string, txHash: string): Promise<ReleaseResponse> {
  const trade = await ctx.db.transaction(async (tx) => {
    const { trade, role } = await lockForAction(tx, ctx, tradeId, viewer);
    requireAction(trade, role, "release", ctx.now());
    if (trade.tx_hash !== txHash) {
      try {
        await tx.query("update trades set tx_hash = $2, updated_at = $3 where id = $1", [tradeId, txHash, ctx.now()]);
      } catch (error) {
        if (isUniqueViolation(error)) throw conflict("Diese Transaktion wurde bereits für einen anderen Handel verwendet.", "tx_reused");
        throw error;
      }
      await systemMessage(tx, tradeId, `Der Verkäufer hat die ADA-Transaktion gemeldet: ${txHash}`);
    }
    return trade;
  });

  const result = await checkPayment(
    {
      txHash,
      toAddress: trade.buyer_address,
      minLovelace: Number(trade.lovelace),
      notBefore: new Date(trade.created_at),
    },
    { network: ctx.config.network, token: ctx.config.koiosToken, fetch: ctx.fetch },
  );

  if (result.ok) {
    await ctx.db.transaction(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `update trades set status = 'completed', completed_at = $2, updated_at = $2, completion_note = 'onchain'
         where id = $1 and status in ('paid', 'disputed') and tx_hash = $3
         returning id`,
        [tradeId, ctx.now(), txHash],
      );
      if (rows.length > 0) {
        await systemMessage(tx, tradeId, `Zahlung auf der Blockchain bestätigt (${formatAda(result.receivedLovelace)}). Der Handel ist abgeschlossen.`);
      }
    });
  }

  return {
    trade: await buildTrade(ctx, tradeId, viewer),
    verification: result.ok
      ? { ok: true, message: "Zahlung auf der Blockchain bestätigt." }
      : { ok: false, message: result.message },
  };
}

export async function postMessage(ctx: AppContext, viewer: UserRow, tradeId: string, body: string): Promise<void> {
  const trade = await loadTradeRow(ctx.db, tradeId);
  if (!trade || !roleOf(ctx, trade, viewer)) throw notFound("Handel nicht gefunden.");
  await ctx.db.query("insert into trade_messages (trade_id, sender_id, body) values ($1, $2, $3)", [tradeId, viewer.id, body]);
}

export async function rateTrade(
  ctx: AppContext,
  viewer: UserRow,
  tradeId: string,
  input: z.infer<typeof rateSchema>,
): Promise<void> {
  const trade = await loadTradeRow(ctx.db, tradeId);
  if (!trade) throw notFound("Handel nicht gefunden.");
  const role = roleOf(ctx, trade, viewer);
  if (role !== "buyer" && role !== "seller") throw notFound("Handel nicht gefunden.");
  if (trade.status !== "completed") throw conflict("Bewerten geht erst nach Abschluss.", "invalid_state");
  const ratee = role === "buyer" ? trade.seller_id : trade.buyer_id;
  try {
    await ctx.db.query(
      "insert into ratings (trade_id, rater_id, ratee_id, positive, comment) values ($1, $2, $3, $4, $5)",
      [tradeId, viewer.id, ratee, input.positive, input.comment],
    );
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict("Du hast diesen Handel bereits bewertet.", "already_rated");
    throw error;
  }
}

export async function resolveDispute(
  ctx: AppContext,
  admin: UserRow,
  tradeId: string,
  input: z.infer<typeof resolveSchema>,
): Promise<void> {
  if (!ctx.config.adminIdentities.has(admin.identity)) throw forbidden();
  await ctx.db.transaction(async (tx) => {
    const { trade, role } = await lockForAction(tx, ctx, tradeId, admin);
    if (role !== "admin") throw forbidden("Eigene Streitfälle können nicht selbst entschieden werden.");
    requireAction(trade, role, "resolve", ctx.now());
    const faultUser = input.fault === "buyer" ? trade.buyer_id : input.fault === "seller" ? trade.seller_id : null;
    if (input.outcome === "completed") {
      await tx.query(
        `update trades set status = 'completed', completed_at = $2, updated_at = $2, completion_note = 'admin' where id = $1`,
        [tradeId, ctx.now()],
      );
    } else {
      await tx.query(
        `update trades set status = 'cancelled', cancelled_at = $2, updated_at = $2, cancel_reason = 'admin', cancel_fault_user_id = $3
         where id = $1`,
        [tradeId, ctx.now(), faultUser],
      );
      await restoreOffer(tx, trade);
    }
    if (input.banFaultUser && faultUser) {
      await tx.query("update users set is_banned = true where id = $1", [faultUser]);
      await tx.query("update offers set status = 'closed', updated_at = now() where user_id = $1 and status <> 'closed'", [faultUser]);
    }
    await systemMessage(
      tx,
      tradeId,
      `Moderation hat entschieden: Handel ${input.outcome === "completed" ? "abgeschlossen" : "abgebrochen"}. Begründung: ${input.note}`,
    );
  });
}

export async function listMyTrades(ctx: AppContext, viewer: UserRow): Promise<TradeSummary[]> {
  const { rows } = await ctx.db.query<TradeRow & { buyer_name: string; seller_name: string }>(
    `select t.*, b.display_name as buyer_name, s.display_name as seller_name
     from trades t join users b on b.id = t.buyer_id join users s on s.id = t.seller_id
     where t.buyer_id = $1 or t.seller_id = $1
     order by (t.status in ('awaiting_payment', 'paid', 'disputed')) desc, t.updated_at desc
     limit 200`,
    [viewer.id],
  );
  return rows.map((row) => toSummary(row, row.buyer_id === viewer.id ? "buyer" : "seller"));
}

function toSummary(row: TradeRow & { buyer_name: string; seller_name: string }, role: "buyer" | "seller"): TradeSummary {
  return {
    id: row.id,
    status: row.status,
    fiat: row.fiat,
    lovelace: Number(row.lovelace),
    fiatCents: Number(row.fiat_cents),
    role,
    counterparty:
      role === "buyer"
        ? { id: row.seller_id, displayName: row.seller_name }
        : { id: row.buyer_id, displayName: row.buyer_name },
    paymentDeadline: toIso(row.payment_deadline),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export async function listDisputes(ctx: AppContext, viewer: UserRow): Promise<DisputeSummary[]> {
  if (!ctx.config.adminIdentities.has(viewer.identity)) throw forbidden();
  const { rows } = await ctx.db.query<TradeRow & { buyer_name: string; seller_name: string }>(
    `select t.*, b.display_name as buyer_name, s.display_name as seller_name
     from trades t join users b on b.id = t.buyer_id join users s on s.id = t.seller_id
     where t.status = 'disputed' order by t.disputed_at`,
  );
  return rows.map((row) => ({
    id: row.id,
    fiat: row.fiat,
    lovelace: Number(row.lovelace),
    fiatCents: Number(row.fiat_cents),
    buyer: { id: row.buyer_id, displayName: row.buyer_name },
    seller: { id: row.seller_id, displayName: row.seller_name },
    disputeReason: row.dispute_reason,
    disputedAt: toIsoOrNull(row.disputed_at),
  }));
}

/** Bricht Trades ab, deren Zahlungsfrist samt Gnadenfrist abgelaufen ist. Gibt die Anzahl zurück. */
export async function expireOverdueTrades(ctx: AppContext): Promise<number> {
  return ctx.db.transaction(async (tx) => {
    const cutoff = new Date(ctx.now().getTime() - AUTO_CANCEL_GRACE_MIN * 60_000);
    const { rows } = await tx.query<TradeRow>(
      `update trades set status = 'cancelled', cancelled_at = $2, updated_at = $2, cancel_reason = 'expired',
         cancel_fault_user_id = buyer_id
       where status = 'awaiting_payment' and payment_deadline < $1
       returning *`,
      [cutoff, ctx.now()],
    );
    for (const trade of rows) {
      await restoreOffer(tx, trade);
      await systemMessage(tx, trade.id, "Die Zahlungsfrist ist abgelaufen. Der Handel wurde automatisch abgebrochen.");
    }
    return rows.length;
  });
}
