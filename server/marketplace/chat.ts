import { z } from "zod";
import type { Conversation, Message } from "../../shared/marketplace";
import { toIso, type AppContext } from "../context";
import type { Queryable } from "../db";
import { badRequest, forbidden, notFound } from "../http";
import type { UserRow } from "../users";
import { listingRow, visible } from "./listings";
export const messageInput = z
  .object({ body: z.string().trim().min(1).max(2000) })
  .strict();
export async function conversationFor(
  db: Queryable,
  listingId: string,
  buyerId: string,
  sellerId: string,
) {
  const { rows } = await db.query<{ id: string }>(
    "insert into cardanomix.conversations (listing_id,buyer_id,seller_id) values ($1,$2,$3) on conflict (listing_id,buyer_id) do update set listing_id=excluded.listing_id returning id",
    [listingId, buyerId, sellerId],
  );
  return rows[0].id;
}
export async function startConversation(
  ctx: AppContext,
  user: UserRow,
  listingId: string,
) {
  const listing = await listingRow(ctx.db, listingId);
  if (!visible(listing, user)) throw notFound();
  if (listing.seller_id === user.id)
    throw badRequest("Du kannst dich nicht selbst kontaktieren.");
  return conversationFor(ctx.db, listingId, user.id, listing.seller_id);
}
export async function requireConversation(
  ctx: AppContext,
  user: UserRow,
  id: string,
) {
  const { rows } = await ctx.db.query<{ buyer_id: string; seller_id: string }>(
    "select buyer_id,seller_id from cardanomix.conversations where id=$1",
    [id],
  );
  if (!rows[0]) throw notFound();
  if (![rows[0].buyer_id, rows[0].seller_id].includes(user.id))
    throw forbidden("Diese Unterhaltung ist privat.");
  return rows[0];
}
export async function conversations(
  ctx: AppContext,
  user: UserRow,
): Promise<Conversation[]> {
  const { rows } = await ctx.db.query<any>(
    "select c.*,l.title,b.display_name as buyer_name,s.display_name as seller_name from cardanomix.conversations c join cardanomix.listings l on l.id=c.listing_id join cardanomix.users b on b.id=c.buyer_id join cardanomix.users s on s.id=c.seller_id where c.buyer_id=$1 or c.seller_id=$1 order by c.updated_at desc limit 100",
    [user.id],
  );
  return rows.map((r) => ({
    id: r.id,
    listingId: r.listing_id,
    title: r.title,
    buyerId: r.buyer_id,
    sellerId: r.seller_id,
    buyerName: r.buyer_name,
    sellerName: r.seller_name,
    updatedAt: toIso(r.updated_at),
  }));
}
export async function getMessages(
  ctx: AppContext,
  user: UserRow,
  id: string,
): Promise<Message[]> {
  await requireConversation(ctx, user, id);
  const { rows } = await ctx.db.query<any>(
    "select * from (select * from cardanomix.messages where conversation_id=$1 order by id desc limit 100) m order by id",
    [id],
  );
  return rows.map((r) => ({
    id: String(r.id),
    senderId: r.sender_id,
    body: r.body,
    createdAt: toIso(r.created_at),
  }));
}
export async function sendMessage(
  ctx: AppContext,
  user: UserRow,
  id: string,
  body: string,
) {
  await requireConversation(ctx, user, id);
  await ctx.db.transaction(async (tx) => {
    await tx.query(
      "select id from cardanomix.conversations where id=$1 for update",
      [id],
    );
    const { rows } = await tx.query<{ count: string }>(
      "select count(*) from cardanomix.messages where sender_id=$1 and created_at>$2",
      [user.id, new Date(ctx.now().getTime() - 60000)],
    );
    if (Number(rows[0].count) >= 20)
      throw badRequest(
        "Bitte eine Minute warten, bevor du weitere Nachrichten sendest.",
      );
    await tx.query(
      "insert into cardanomix.messages (conversation_id,sender_id,body,created_at) values ($1,$2,$3,$4)",
      [id, user.id, body, ctx.now()],
    );
    await tx.query(
      "update cardanomix.conversations set updated_at=$2 where id=$1",
      [id, ctx.now()],
    );
  });
}
