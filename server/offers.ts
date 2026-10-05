import { z } from "zod";
import {
  FIATS,
  MAX_OFFER_LOVELACE,
  MIN_TRADE_LOVELACE,
  OFFER_SIDES,
  PAYMENT_METHODS,
  type Fiat,
  type OfferSide,
  type OfferStatus,
  type PaymentMethod,
} from "../shared/constants";
import { applyMargin, fiatCentsFor, parseAdaToLovelace, parseFiatToCents, parsePriceToMicro } from "../shared/money";
import type { Offer } from "../shared/types";
import { toIso, type AppContext } from "./context";
import type { Queryable } from "./db";
import { badRequest, conflict, forbidden, notFound } from "./http";
import { loadStats, toPublicUser, type UserRow } from "./users";

const MAX_ACTIVE_OFFERS = 10;

export interface OfferRow {
  id: string;
  user_id: string;
  side: OfferSide;
  asset: "ADA";
  fiat: Fiat;
  price_type: "fixed" | "margin";
  fixed_price_micro: unknown;
  margin_bps: number | null;
  available_lovelace: unknown;
  min_fiat_cents: unknown;
  max_fiat_cents: unknown;
  payment_methods: PaymentMethod[];
  terms: string;
  payment_window_min: number;
  status: OfferStatus;
  created_at: Date | string;
  maker_name: string;
  maker_created_at: Date | string;
}

const OFFER_SELECT = `
  select o.*, u.display_name as maker_name, u.created_at as maker_created_at
  from cardanomix.offers o join cardanomix.users u on u.id = o.user_id`;

export const createOfferSchema = z
  .object({
    side: z.enum(OFFER_SIDES),
    fiat: z.enum(FIATS),
    priceType: z.enum(["fixed", "margin"]),
    fixedPrice: z.string().max(20).optional(),
    marginPercent: z.number().min(-20, "Abschlag höchstens 20 %.").max(20, "Aufschlag höchstens 20 %.").optional(),
    amountAda: z.string().max(20),
    minFiat: z.string().max(20),
    maxFiat: z.string().max(20),
    paymentMethods: z
      .array(z.enum(PAYMENT_METHODS))
      .min(1, "Mindestens eine Zahlungsart wählen.")
      .max(PAYMENT_METHODS.length),
    terms: z.string().max(1000, "Bedingungen höchstens 1000 Zeichen.").default(""),
    paymentWindowMin: z.number().int().min(15).max(180),
  })
  .strict();

export const offerStatusSchema = z.object({ status: z.enum(["active", "paused", "closed"]) }).strict();

export function priceFor(row: Pick<OfferRow, "price_type" | "fixed_price_micro" | "margin_bps">, market: number | null) {
  if (row.price_type === "fixed") return Number(row.fixed_price_micro);
  if (market == null) return null;
  return applyMargin(market, row.margin_bps ?? 0);
}

async function toOffers(ctx: AppContext, rows: OfferRow[]): Promise<Offer[]> {
  const stats = await loadStats(ctx.db, rows.map((row) => row.user_id));
  const markets = new Map<Fiat, number | null>();
  for (const fiat of new Set(rows.map((row) => row.fiat))) {
    markets.set(fiat, await ctx.prices.marketPriceMicro(fiat));
  }
  return rows.map((row) => {
    const priceMicro = priceFor(row, markets.get(row.fiat) ?? null);
    const available = Number(row.available_lovelace);
    const max = Number(row.max_fiat_cents);
    return {
      id: row.id,
      side: row.side,
      asset: "ADA",
      fiat: row.fiat,
      priceType: row.price_type,
      fixedPriceMicro: row.fixed_price_micro == null ? null : Number(row.fixed_price_micro),
      marginBps: row.margin_bps,
      priceMicro,
      availableLovelace: available,
      minFiatCents: Number(row.min_fiat_cents),
      maxFiatCents: max,
      effectiveMaxFiatCents: priceMicro == null ? null : Math.min(max, fiatCentsFor(available, priceMicro)),
      paymentMethods: row.payment_methods,
      terms: row.terms,
      paymentWindowMin: row.payment_window_min,
      status: row.status,
      createdAt: toIso(row.created_at),
      maker: toPublicUser(
        { id: row.user_id, display_name: row.maker_name, created_at: row.maker_created_at },
        stats.get(row.user_id),
      ),
    };
  });
}

export async function loadOfferRow(db: Queryable, id: string, lock = false): Promise<OfferRow | null> {
  const { rows } = await db.query<OfferRow>(
    lock
      ? `${OFFER_SELECT} where o.id = $1 for update of o`
      : `${OFFER_SELECT} where o.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function getOffer(ctx: AppContext, id: string): Promise<Offer> {
  const row = await loadOfferRow(ctx.db, id);
  if (!row || row.status === "closed") throw notFound("Angebot nicht gefunden.");
  const [offer] = await toOffers(ctx, [row]);
  return offer;
}

export interface MarketFilter {
  side: OfferSide;
  fiat?: Fiat;
  method?: PaymentMethod;
  amountCents?: number;
}

/** Aktive, handelbare Angebote; Käufer sehen die günstigsten zuerst, Verkäufer die besten Gebote. */
export async function listMarket(ctx: AppContext, filter: MarketFilter): Promise<Offer[]> {
  const { rows } = await ctx.db.query<OfferRow>(
    `${OFFER_SELECT}
     where o.status = 'active' and not u.is_banned and o.side = $1
       and ($2::text is null or o.fiat = $2)
       and ($3::text is null or $3 = any(o.payment_methods))
     order by o.created_at desc
     limit 300`,
    [filter.side, filter.fiat ?? null, filter.method ?? null],
  );
  const offers = (await toOffers(ctx, rows)).filter((offer) => {
    if (offer.priceMicro == null || offer.effectiveMaxFiatCents == null) return false;
    if (offer.effectiveMaxFiatCents < offer.minFiatCents) return false;
    if (filter.amountCents != null) {
      return filter.amountCents >= offer.minFiatCents && filter.amountCents <= offer.effectiveMaxFiatCents;
    }
    return true;
  });
  const direction = filter.side === "sell" ? 1 : -1;
  return offers.sort((a, b) => direction * ((a.priceMicro ?? 0) - (b.priceMicro ?? 0)));
}

export async function listUserOffers(ctx: AppContext, userId: string, includeInactive: boolean): Promise<Offer[]> {
  const { rows } = await ctx.db.query<OfferRow>(
    `${OFFER_SELECT}
     where o.user_id = $1 and (o.status = 'active' or ($2 and o.status = 'paused'))
     order by o.created_at desc`,
    [userId, includeInactive],
  );
  return toOffers(ctx, rows);
}

export async function createOffer(ctx: AppContext, user: UserRow, input: z.infer<typeof createOfferSchema>): Promise<Offer> {
  const available = parseAdaToLovelace(input.amountAda);
  if (available == null || available < MIN_TRADE_LOVELACE) throw badRequest("Menge: mindestens 2 ADA.");
  if (available > MAX_OFFER_LOVELACE) throw badRequest("Menge: höchstens 10 Mio. ADA pro Angebot.");

  const minCents = parseFiatToCents(input.minFiat);
  const maxCents = parseFiatToCents(input.maxFiat);
  if (minCents == null || minCents < 100) throw badRequest("Mindestbetrag: mindestens 1,00.");
  if (maxCents == null || maxCents < minCents) throw badRequest("Höchstbetrag muss mindestens so groß wie der Mindestbetrag sein.");
  if (maxCents > 100_000_000) throw badRequest("Höchstbetrag: höchstens 1.000.000 pro Handel.");

  let fixedPriceMicro: number | null = null;
  let marginBps: number | null = null;
  if (input.priceType === "fixed") {
    fixedPriceMicro = input.fixedPrice ? parsePriceToMicro(input.fixedPrice) : null;
    if (!fixedPriceMicro || fixedPriceMicro <= 0 || fixedPriceMicro > 1_000_000_000) {
      throw badRequest("Bitte einen gültigen Festpreis pro ADA angeben.");
    }
  } else {
    if (input.marginPercent == null) throw badRequest("Bitte den Auf- oder Abschlag angeben.");
    marginBps = Math.round(input.marginPercent * 100);
  }

  const methods = [...new Set(input.paymentMethods)];

  const id = await ctx.db.transaction(async (tx) => {
    // Sperrt die Nutzerzeile, damit parallele Anfragen das Limit nicht umgehen.
    await tx.query("select id from cardanomix.users where id = $1 for update", [user.id]);
    const { rows } = await tx.query<{ count: unknown }>(
      "select count(*) as count from cardanomix.offers where user_id = $1 and status <> 'closed'",
      [user.id],
    );
    if (Number(rows[0]?.count ?? 0) >= MAX_ACTIVE_OFFERS) {
      throw conflict(`Höchstens ${MAX_ACTIVE_OFFERS} offene Angebote pro Konto.`, "too_many_offers");
    }
    const { rows: inserted } = await tx.query<{ id: string }>(
      `insert into cardanomix.offers (user_id, side, fiat, price_type, fixed_price_micro, margin_bps, available_lovelace,
         min_fiat_cents, max_fiat_cents, payment_methods, terms, payment_window_min)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       returning id`,
      [
        user.id,
        input.side,
        input.fiat,
        input.priceType,
        fixedPriceMicro,
        marginBps,
        available,
        minCents,
        maxCents,
        methods,
        input.terms.trim(),
        input.paymentWindowMin,
      ],
    );
    return inserted[0].id;
  });
  return getOffer(ctx, id);
}

export async function setOfferStatus(ctx: AppContext, user: UserRow, offerId: string, status: OfferStatus): Promise<void> {
  const { rows } = await ctx.db.query<{ id: string }>(
    `update cardanomix.offers set status = $3, updated_at = now()
     where id = $1 and user_id = $2 and status <> 'closed'
     returning id`,
    [offerId, user.id, status],
  );
  if (rows.length === 0) {
    const existing = await loadOfferRow(ctx.db, offerId);
    if (!existing || existing.status === "closed") throw notFound("Angebot nicht gefunden.");
    throw forbidden("Nur der Anbieter kann das Angebot ändern.");
  }
}
