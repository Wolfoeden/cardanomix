import { z } from "zod";
import { toIso, type AppContext } from "../context";
import { forbidden, notFound } from "../http";
import type { UserRow } from "../users";
import { listingRow, visible } from "./listings";
export function requireAdmin(ctx: AppContext, user: UserRow) {
  if (!ctx.config.adminIdentities.has(user.identity))
    throw forbidden("Nur Moderatoren haben Zugriff.");
}
export const reportInput = z
  .object({ reason: z.string().trim().min(5).max(2000) })
  .strict();
export const moderationInput = z
  .object({ action: z.enum(["hide", "resolve", "ban"]) })
  .strict();
export async function reportListing(
  ctx: AppContext,
  user: UserRow,
  id: string,
  reason: string,
) {
  const l = await listingRow(ctx.db, id);
  if (!visible(l, user)) throw notFound();
  await ctx.db.query(
    "insert into cardanomix.reports (listing_id,reporter_id,reason) values ($1,$2,$3) on conflict (listing_id,reporter_id) where status='open' do update set reason=excluded.reason",
    [id, user.id, reason],
  );
}
export async function reports(ctx: AppContext, user: UserRow) {
  requireAdmin(ctx, user);
  const { rows } = await ctx.db.query<any>(
    "select r.*,l.title from cardanomix.reports r join cardanomix.listings l on l.id=r.listing_id where r.status='open' order by r.created_at limit 100",
  );
  return rows.map((r) => ({
    id: r.id,
    listingId: r.listing_id,
    title: r.title,
    reason: r.reason,
    status: r.status,
    createdAt: toIso(r.created_at),
  }));
}
export async function moderateReport(
  ctx: AppContext,
  user: UserRow,
  id: string,
  action: string,
) {
  requireAdmin(ctx, user);
  await ctx.db.transaction(async (tx) => {
    const { rows } = await tx.query<{ listing_id: string }>(
      "select listing_id from cardanomix.reports where id=$1 for update",
      [id],
    );
    if (!rows[0]) throw notFound();
    const l = await listingRow(tx, rows[0].listing_id, true);
    if (action !== "resolve")
      await tx.query(
        "update cardanomix.listings set status='hidden' where id=$1",
        [l.id],
      );
    if (action === "ban")
      await tx.query("update cardanomix.users set is_banned=true where id=$1", [
        l.seller_id,
      ]);
    await tx.query(
      "update cardanomix.reports set status='resolved' where id=$1",
      [id],
    );
  });
}
export async function disputedOrders(ctx: AppContext, user: UserRow) {
  requireAdmin(ctx, user);
  const { rows } = await ctx.db.query<any>(
    "select id,title,dispute_reason from cardanomix.orders where status='disputed' order by updated_at limit 100",
  );
  return rows;
}
export async function resolveOrder(
  ctx: AppContext,
  user: UserRow,
  id: string,
  note: string,
) {
  requireAdmin(ctx, user);
  await ctx.db.query(
    "update cardanomix.orders set status='completed',fulfillment_note=fulfillment_note||$2,updated_at=$3 where id=$1 and status='disputed'",
    [id, `\nModeration: ${note}. Keine automatische Rückzahlung.`, ctx.now()],
  );
}
