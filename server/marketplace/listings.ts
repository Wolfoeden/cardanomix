import { z } from "zod";
import {
  CATEGORIES,
  LISTING_TYPES,
  type Listing,
  type ListingInput,
} from "../../shared/marketplace";
import { parseAdaToLovelace } from "../../shared/money";
import { toIso, type AppContext } from "../context";
import type { Queryable } from "../db";
import { badRequest, conflict, forbidden, notFound } from "../http";
import type { UserRow } from "../users";
import { imageUrls } from "./storage";

export const listingSchema = z
  .object({
    title: z.string().trim().min(3).max(120),
    description: z.string().trim().min(10).max(10000),
    category: z.enum(CATEGORIES),
    type: z.enum(LISTING_TYPES),
    priceAda: z.string().max(20),
    shippingAda: z.string().max(20).default("0"),
    delivery: z.enum(["shipping", "pickup", "digital"]),
    condition: z.string().trim().max(100).default(""),
    location: z.string().trim().max(100).default(""),
    terms: z.string().trim().max(3000).default(""),
    serviceScope: z.string().trim().max(3000).default(""),
    deliveryDays: z.number().int().min(0).max(365).default(7),
  })
  .strict();
export const listingStatusSchema = z
  .object({ status: z.enum(["active", "paused", "archived"]) })
  .strict();
export const listingFilterSchema = z.object({
  q: z.string().max(120).default(""),
  category: z.enum(CATEGORIES).optional(),
  type: z.enum(LISTING_TYPES).optional(),
  min: z.string().max(20).optional(),
  max: z.string().max(20).optional(),
  sort: z.enum(["newest", "price_asc", "price_desc"]).default("newest"),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
});
export interface ListingRow {
  id: string;
  seller_id: string;
  seller_name: string;
  seller_banned: boolean;
  title: string;
  description: string;
  category: string;
  type: string;
  price_lovelace: unknown;
  shipping_lovelace: unknown;
  delivery: string;
  condition: string;
  location: string;
  terms: string;
  service_scope: string;
  delivery_days: number;
  status: string;
  created_at: Date | string;
}
const SELECT =
  "select l.*, u.display_name as seller_name, u.is_banned as seller_banned from cardanomix.listings l join cardanomix.users u on u.id=l.seller_id";
export async function listingRow(db: Queryable, id: string, lock = false) {
  const { rows } = await db.query<ListingRow>(
    `${SELECT} where l.id=$1${lock ? " for update of l" : ""}`,
    [id],
  );
  if (!rows[0]) throw notFound("Angebot nicht gefunden.");
  return rows[0];
}
export function requireOwner(row: ListingRow, user: UserRow) {
  if (row.seller_id !== user.id)
    throw forbidden("Nur der Anbieter kann dieses Angebot ändern.");
}
export function visible(row: ListingRow, user?: UserRow | null) {
  return (
    row.seller_id === user?.id ||
    (!row.seller_banned && ["active", "reserved", "sold"].includes(row.status))
  );
}
export async function toListing(
  ctx: AppContext,
  row: ListingRow,
): Promise<Listing> {
  return {
    id: row.id,
    sellerId: row.seller_id,
    sellerName: row.seller_name,
    title: row.title,
    description: row.description,
    category: row.category,
    type: row.type,
    priceLovelace: Number(row.price_lovelace),
    shippingLovelace: Number(row.shipping_lovelace),
    delivery: row.delivery,
    condition: row.condition,
    location: row.location,
    terms: row.terms,
    serviceScope: row.service_scope,
    deliveryDays: row.delivery_days,
    status: row.status,
    createdAt: toIso(row.created_at),
    images: await imageUrls(ctx, row.id),
  };
}
export async function getListing(
  ctx: AppContext,
  id: string,
  user?: UserRow | null,
) {
  const row = await listingRow(ctx.db, id);
  if (!visible(row, user)) throw notFound("Angebot nicht gefunden.");
  return toListing(ctx, row);
}
function amounts(input: ListingInput) {
  const price = parseAdaToLovelace(input.priceAda),
    shipping = parseAdaToLovelace(input.shippingAda);
  if (price == null || price < 2_000_000 || price > 10_000_000_000_000)
    throw badRequest("Preis: mindestens 2 und höchstens 10 Millionen ADA.");
  if (shipping == null || shipping < 0 || shipping > 10_000_000_000)
    throw badRequest("Versandkosten: 0 bis 10.000 ADA.");
  if (input.delivery !== "shipping" && shipping !== 0)
    throw badRequest("Versandkosten sind nur bei Versand erlaubt.");
  if (input.type !== "goods" && input.delivery !== "digital")
    throw badRequest(
      "Digitale Produkte und Dienstleistungen werden digital geliefert.",
    );
  if (
    input.type === "goods" &&
    (!input.condition || input.delivery === "digital")
  )
    throw badRequest("Bitte Zustand und Versand oder Abholung wählen.");
  if (input.type === "service" && input.serviceScope.length < 10)
    throw badRequest("Bitte den Leistungsumfang beschreiben.");
  return { price, shipping };
}
export async function saveListing(
  ctx: AppContext,
  user: UserRow,
  input: ListingInput,
  id?: string,
) {
  const { price, shipping } = amounts(input);
  const saved = await ctx.db.transaction(async (tx) => {
    await tx.query("select id from cardanomix.users where id=$1 for update", [
      user.id,
    ]);
    if (id) {
      const row = await listingRow(tx, id, true);
      requireOwner(row, user);
      if (!["draft", "active", "paused"].includes(row.status))
        throw conflict("Dieses Angebot kann nicht bearbeitet werden.");
    } else {
      const { rows } = await tx.query<{ count: string }>(
        "select count(*) from cardanomix.listings where seller_id=$1 and status not in ('sold','archived','hidden')",
        [user.id],
      );
      if (Number(rows[0].count) >= 50)
        throw conflict("Höchstens 50 offene Inserate pro Konto.");
    }
    const values = [
      user.id,
      input.title,
      input.description,
      input.category,
      input.type,
      price,
      shipping,
      input.delivery,
      input.condition,
      input.location,
      input.terms,
      input.serviceScope,
      input.deliveryDays,
    ];
    const { rows } = id
      ? await tx.query<{ id: string }>(
          `update cardanomix.listings set title=$2,description=$3,category=$4,type=$5,price_lovelace=$6,shipping_lovelace=$7,delivery=$8,condition=$9,location=$10,terms=$11,service_scope=$12,delivery_days=$13,updated_at=$15 where seller_id=$1 and id=$14 returning id`,
          [...values, id, ctx.now()],
        )
      : await tx.query<{ id: string }>(
          `insert into cardanomix.listings (seller_id,title,description,category,type,price_lovelace,shipping_lovelace,delivery,condition,location,terms,service_scope,delivery_days) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning id`,
          values,
        );
    return rows[0].id;
  });
  return getListing(ctx, saved, user);
}
export async function setListingStatus(
  ctx: AppContext,
  user: UserRow,
  id: string,
  status: string,
) {
  await ctx.db.transaction(async (tx) => {
    const row = await listingRow(tx, id, true);
    requireOwner(row, user);
    if (!["draft", "active", "paused"].includes(row.status))
      throw conflict(
        "Reservierte, verkaufte oder ausgeblendete Angebote lassen sich nicht ändern.",
      );
    if (status === "active") {
      const { rows } = await tx.query<{ count: string }>(
        "select count(*) from cardanomix.listing_images where listing_id=$1 and status in ('pending','processing')",
        [id],
      );
      if (Number(rows[0].count) > 0)
        throw conflict(
          "Bitte die Bildverarbeitung abschließen oder offene Bilder entfernen.",
        );
    }
    await tx.query(
      "update cardanomix.listings set status=$2,updated_at=$3 where id=$1",
      [id, status, ctx.now()],
    );
  });
  return getListing(ctx, id, user);
}
export async function duplicateListing(
  ctx: AppContext,
  user: UserRow,
  id: string,
) {
  const row = await listingRow(ctx.db, id);
  requireOwner(row, user);
  return saveListing(ctx, user, {
    title: row.title,
    description: row.description,
    category: row.category as ListingInput["category"],
    type: row.type as ListingInput["type"],
    priceAda: String(Number(row.price_lovelace) / 1e6),
    shippingAda: String(Number(row.shipping_lovelace) / 1e6),
    delivery: row.delivery as ListingInput["delivery"],
    condition: row.condition,
    location: row.location,
    terms: row.terms,
    serviceScope: row.service_scope,
    deliveryDays: row.delivery_days,
  });
}
export async function listListings(
  ctx: AppContext,
  filter: z.infer<typeof listingFilterSchema>,
  owner?: UserRow,
) {
  const min = filter.min ? parseAdaToLovelace(filter.min) : null,
    max = filter.max ? parseAdaToLovelace(filter.max) : null;
  if (
    (filter.min && min == null) ||
    (filter.max && max == null) ||
    (min != null && max != null && min > max)
  )
    throw badRequest("Ungültiger Preisfilter.");
  const order =
    filter.sort === "price_asc"
      ? "l.price_lovelace asc,l.id"
      : filter.sort === "price_desc"
        ? "l.price_lovelace desc,l.id"
        : "l.created_at desc,l.id";
  const { rows } = await ctx.db.query<ListingRow>(
    `${SELECT} where ($1::uuid is not null and l.seller_id=$1 or $1::uuid is null and l.status='active' and not u.is_banned) and ($2='' or l.title ilike '%'||$2||'%' or l.description ilike '%'||$2||'%') and ($3::text is null or l.category=$3) and ($4::text is null or l.type=$4) and ($5::bigint is null or l.price_lovelace>=$5) and ($6::bigint is null or l.price_lovelace<=$6) order by ${order} limit 25 offset $7`,
    [
      owner?.id ?? null,
      filter.q,
      filter.category ?? null,
      filter.type ?? null,
      min,
      max,
      filter.offset,
    ],
  );
  return Promise.all(rows.map((row) => toListing(ctx, row)));
}
