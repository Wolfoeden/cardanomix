import { z } from "zod";
import {
  DEFAULT_FEE_ADDRESS,
  PLATFORM_FEE_LOVELACE,
  type Order,
} from "../../shared/marketplace";
import { parseAddress } from "../cardano/address";
import { toIso, type AppContext } from "../context";
import type { Queryable } from "../db";
import { badRequest, conflict, forbidden, notFound } from "../http";
import type { UserRow } from "../users";
import { conversationFor } from "./chat";
import { listingRow } from "./listings";
export const orderInput = z
  .object({ deliveryDetails: z.string().trim().max(1500).default("") })
  .strict();
export const orderActionInput = z
  .object({
    action: z.enum(["cancel", "fulfill", "complete", "dispute"]),
    note: z.string().trim().max(2000).default(""),
  })
  .strict();
export interface OrderRow {
  id: string;
  listing_id: string;
  buyer_id: string;
  seller_id: string;
  conversation_id: string;
  title: string;
  description: string;
  terms: string;
  price_lovelace: unknown;
  shipping_lovelace: unknown;
  fee_lovelace: unknown;
  seller_address: string;
  fee_address: string;
  delivery: string;
  delivery_details: string;
  fulfillment_note: string;
  dispute_reason: string;
  status: string;
  payment_deadline: Date | string;
  created_at: Date | string;
  seller_name: string;
  buyer_name: string;
  tx_hash: string | null;
  confirmations: number | null;
}
const SELECT =
  "select o.*,s.display_name as seller_name,b.display_name as buyer_name,p.tx_hash,p.confirmations from cardanomix.orders o join cardanomix.users s on s.id=o.seller_id join cardanomix.users b on b.id=o.buyer_id left join cardanomix.order_payments p on p.order_id=o.id";
export async function orderRow(db: Queryable, id: string, lock = false) {
  const { rows } = await db.query<OrderRow>(
    `${SELECT} where o.id=$1${lock ? " for update of o" : ""}`,
    [id],
  );
  if (!rows[0]) throw notFound("Bestellung nicht gefunden.");
  return rows[0];
}
export function requireParty(row: OrderRow, user: UserRow) {
  if (![row.buyer_id, row.seller_id].includes(user.id))
    throw forbidden("Diese Bestellung ist privat.");
}
export function toOrder(r: OrderRow): Order {
  return {
    id: r.id,
    listingId: r.listing_id,
    title: r.title,
    description: r.description,
    buyerId: r.buyer_id,
    sellerId: r.seller_id,
    sellerName: r.seller_name,
    buyerName: r.buyer_name,
    sellerAddress: r.seller_address,
    feeAddress: r.fee_address,
    priceLovelace: Number(r.price_lovelace),
    shippingLovelace: Number(r.shipping_lovelace),
    feeLovelace: Number(r.fee_lovelace),
    status: r.status,
    deadline: toIso(r.payment_deadline),
    txHash: r.tx_hash,
    confirmations: r.confirmations ?? 0,
    delivery: r.delivery,
    deliveryDetails: r.delivery_details,
    terms: r.terms,
    fulfillmentNote: r.fulfillment_note,
    disputeReason: r.dispute_reason,
    conversationId: r.conversation_id,
    createdAt: toIso(r.created_at),
  };
}
export async function getOrder(ctx: AppContext, user: UserRow, id: string) {
  const row = await orderRow(ctx.db, id);
  requireParty(row, user);
  return toOrder(row);
}
export async function myOrders(ctx: AppContext, user: UserRow) {
  const { rows } = await ctx.db.query<OrderRow>(
    `${SELECT} where o.buyer_id=$1 or o.seller_id=$1 order by o.created_at desc limit 100`,
    [user.id],
  );
  return rows.map(toOrder);
}
export async function createOrder(
  ctx: AppContext,
  user: UserRow,
  listingId: string,
  details: string,
) {
  const feeAddress = ctx.config.feeAddress ?? DEFAULT_FEE_ADDRESS,
    fee = parseAddress(feeAddress),
    expected = ctx.config.network === "mainnet" ? 1 : 0;
  if (!fee?.paymentKeyHash || fee.networkId !== expected)
    throw badRequest(
      "Die Gebührenadresse passt nicht zum Netzwerk. Für Preprod ist eine Testadresse erforderlich.",
    );
  const id = await ctx.db.transaction(async (tx) => {
    const l = await listingRow(tx, listingId, true);
    if (l.seller_id === user.id)
      throw badRequest("Eigene Angebote können nicht gekauft werden.");
    if (l.status !== "active" || l.seller_banned)
      throw conflict("Dieses Angebot ist nicht verfügbar.");
    if (l.delivery === "shipping" && details.length < 10)
      throw badRequest("Bitte vollständige Lieferdaten angeben.");
    const pending = await tx.query<{ count: string }>(
      "select count(*) from cardanomix.listing_images where listing_id=$1 and status in ('pending','processing')",
      [listingId],
    );
    if (Number(pending.rows[0].count))
      throw conflict(
        "Der Anbieter bearbeitet die Bilder. Bitte später erneut versuchen.",
      );
    const { rows: sellers } = await tx.query<{ receive_address: string }>(
      "select receive_address from cardanomix.users where id=$1",
      [l.seller_id],
    );
    const address = sellers[0].receive_address,
      seller = parseAddress(address);
    if (!seller?.paymentKeyHash || seller.networkId !== expected)
      throw badRequest(
        "Die Verkäuferadresse ist ungültig oder gehört zu einem anderen Netzwerk.",
      );
    const conversationId = await conversationFor(
      tx,
      listingId,
      user.id,
      l.seller_id,
    );
    const { rows } = await tx.query<{ id: string }>(
      "insert into cardanomix.orders (listing_id,buyer_id,seller_id,conversation_id,title,description,terms,price_lovelace,shipping_lovelace,fee_lovelace,seller_address,fee_address,delivery,delivery_details,payment_deadline,created_at) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning id",
      [
        listingId,
        user.id,
        l.seller_id,
        conversationId,
        l.title,
        l.description,
        [
          l.terms,
          l.service_scope,
          `Lieferzeit: ${l.delivery_days} Tage`,
          l.condition,
          l.location,
        ]
          .filter(Boolean)
          .join("\n"),
        l.price_lovelace,
        l.shipping_lovelace,
        PLATFORM_FEE_LOVELACE,
        address,
        feeAddress,
        l.delivery,
        details,
        new Date(ctx.now().getTime() + 900000),
        ctx.now(),
      ],
    );
    await tx.query(
      "update cardanomix.listings set status='reserved',updated_at=$2 where id=$1",
      [listingId, ctx.now()],
    );
    return rows[0].id;
  });
  return getOrder(ctx, user, id);
}
export async function orderAction(
  ctx: AppContext,
  user: UserRow,
  id: string,
  action: string,
  note: string,
) {
  await ctx.db.transaction(async (tx) => {
    const o = await orderRow(tx, id, true);
    requireParty(o, user);
    let status: string;
    if (action === "cancel") {
      if (o.status !== "awaiting_payment" || o.tx_hash)
        throw conflict(
          "Eine vorbereitete Zahlung bleibt bis zum geprüften Transaktionsverfall reserviert.",
        );
      status = "cancelled";
      await tx.query(
        "update cardanomix.order_payments set status='expired' where order_id=$1 and status='prepared'",
        [id],
      );
      await tx.query(
        "update cardanomix.listings set status='active' where id=$1 and status='reserved'",
        [o.listing_id],
      );
    } else if (action === "fulfill") {
      if (user.id !== o.seller_id || o.status !== "paid")
        throw forbidden(
          "Nur der Verkäufer kann eine bezahlte Bestellung als geliefert markieren.",
        );
      if (note.length < 3)
        throw badRequest("Bitte Versand oder Leistung beschreiben.");
      status = "fulfilled";
    } else if (action === "complete") {
      if (user.id !== o.buyer_id || !["paid", "fulfilled"].includes(o.status))
        throw forbidden(
          "Nur der Käufer kann eine bezahlte Bestellung abschließen.",
        );
      status = "completed";
    } else {
      if (!["paid", "fulfilled"].includes(o.status))
        throw conflict("Ein Streitfall ist erst nach Zahlung möglich.");
      if (note.length < 5)
        throw badRequest("Bitte den Streitfall beschreiben.");
      status = "disputed";
    }
    await tx.query(
      "update cardanomix.orders set status=$2,fulfillment_note=case when $3='fulfill' then $4 else fulfillment_note end,dispute_reason=case when $3='dispute' then $4 else dispute_reason end,updated_at=$5 where id=$1",
      [id, status, action, note, ctx.now()],
    );
  });
  return getOrder(ctx, user, id);
}
export async function expireUnpaid(ctx: AppContext) {
  const { rows } = await ctx.db.query<{ id: string }>(
    "select id from cardanomix.orders o where status='awaiting_payment' and payment_deadline<$1 and not exists (select 1 from cardanomix.order_payments p where p.order_id=o.id) limit 50",
    [ctx.now()],
  );
  for (const row of rows)
    await ctx.db.transaction(async (tx) => {
      const o = await orderRow(tx, row.id, true);
      if (
        o.status !== "awaiting_payment" ||
        o.tx_hash ||
        new Date(o.payment_deadline) > ctx.now()
      )
        return;
      await tx.query(
        "update cardanomix.orders set status='expired',updated_at=$2 where id=$1",
        [o.id, ctx.now()],
      );
      await tx.query(
        "update cardanomix.order_payments set status='expired' where order_id=$1 and status='prepared'",
        [o.id],
      );
      await tx.query(
        "update cardanomix.listings set status='active' where id=$1 and status='reserved'",
        [o.listing_id],
      );
    });
  return rows.length;
}
