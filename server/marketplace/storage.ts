import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { z } from "zod";
import type { ListingImage } from "../../shared/marketplace";
import type { AppContext } from "../context";
import { badRequest, conflict, HttpError, notFound } from "../http";
import type { UserRow } from "../users";
import { listingRow, requireOwner } from "./listings";

export interface ImageStorage {
  signUpload(path: string): Promise<string>;
  download(path: string): Promise<Uint8Array>;
  put(path: string, bytes: Uint8Array): Promise<void>;
  urls(paths: string[]): Promise<string[]>;
  remove(bucket: "uploads" | "images", paths: string[]): Promise<void>;
}
const cache = new WeakMap<AppContext, ImageStorage>();
export function setImageStorage(ctx: AppContext, storage: ImageStorage) {
  cache.set(ctx, storage);
}
export function storageFor(ctx: AppContext): ImageStorage {
  const existing = cache.get(ctx);
  if (existing) return existing;
  if (!ctx.config.supabaseUrl || !ctx.config.supabaseSecret)
    throw new HttpError(
      503,
      "storage_unavailable",
      "Der Bildspeicher ist noch nicht eingerichtet.",
    );
  const client = createClient(
    ctx.config.supabaseUrl,
    ctx.config.supabaseSecret,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const checked = <T>(result: { data: T | null; error: unknown }) => {
    if (result.error || result.data == null)
      throw new HttpError(
        502,
        "storage_unavailable",
        "Bildspeicher nicht erreichbar. Bitte erneut versuchen.",
      );
    return result.data;
  };
  const storage: ImageStorage = {
    async signUpload(path) {
      return checked(
        await client.storage
          .from("cardanomix-uploads")
          .createSignedUploadUrl(path, { upsert: false }),
      ).signedUrl;
    },
    async download(path) {
      const blob = checked(
        await client.storage.from("cardanomix-uploads").download(path),
      );
      if (blob.size > 5 * 1024 * 1024)
        throw badRequest("Bild höchstens 5 MiB.");
      return new Uint8Array(await blob.arrayBuffer());
    },
    async put(path, bytes) {
      checked(
        await client.storage
          .from("cardanomix-images")
          .upload(path, bytes, { contentType: "image/webp", upsert: true }),
      );
    },
    async urls(paths) {
      if (!paths.length) return [];
      return checked(
        await client.storage
          .from("cardanomix-images")
          .createSignedUrls(paths, 300),
      ).map((x) => {
        if (x.error || !x.signedUrl)
          throw new HttpError(
            502,
            "image_unavailable",
            "Bild konnte nicht geladen werden.",
          );
        return x.signedUrl;
      });
    },
    async remove(bucket, paths) {
      if (paths.length)
        checked(
          await client.storage.from(`cardanomix-${bucket}`).remove(paths),
        );
    },
  };
  cache.set(ctx, storage);
  return storage;
}
export const uploadSchema = z
  .object({
    contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    size: z.number().int().min(1).max(5242880),
  })
  .strict();
export async function startUpload(
  ctx: AppContext,
  user: UserRow,
  listingId: string,
  input: z.infer<typeof uploadSchema>,
) {
  const storage = storageFor(ctx),
    id = randomUUID(),
    extension = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
    }[input.contentType];
  const path = `${user.id}/${listingId}/${id}.${extension}`;
  await ctx.db.transaction(async (tx) => {
    const listing = await listingRow(tx, listingId, true);
    requireOwner(listing, user);
    if (!["draft", "active", "paused"].includes(listing.status))
      throw conflict("Für dieses Angebot können keine Bilder geändert werden.");
    const { rows } = await tx.query<{ position: number }>(
      "select position from cardanomix.listing_images where listing_id=$1 and status<>'deleted'",
      [listingId],
    );
    const position = Array.from({ length: 10 }, (_, i) => i).find(
      (i) => !rows.some((row) => row.position === i),
    );
    if (position == null) throw conflict("Höchstens zehn Bilder pro Angebot.");
    await tx.query(
      "insert into cardanomix.listing_images (id,listing_id,owner_id,upload_path,position,created_at) values ($1,$2,$3,$4,$5,$6)",
      [id, listingId, user.id, path, position, ctx.now()],
    );
  });
  try {
    return { imageId: id, uploadUrl: await storage.signUpload(path) };
  } catch (error) {
    await ctx.db.query(
      "update cardanomix.listing_images set status='deleted' where id=$1",
      [id],
    );
    throw error;
  }
}
export async function finishUpload(
  ctx: AppContext,
  user: UserRow,
  listingId: string,
  imageId: string,
) {
  const storage = storageFor(ctx);
  const path = await ctx.db.transaction(async (tx) => {
    const row = await listingRow(tx, listingId, true);
    requireOwner(row, user);
    if (!["draft", "active", "paused"].includes(row.status))
      throw conflict("Dieses Angebot kann nicht geändert werden.");
    const { rows } = await tx.query<{ upload_path: string }>(
      "update cardanomix.listing_images set status='processing' where id=$1 and listing_id=$2 and owner_id=$3 and status='pending' returning upload_path",
      [imageId, listingId, user.id],
    );
    if (!rows[0])
      throw conflict("Bild nicht gefunden oder bereits verarbeitet.");
    return rows[0].upload_path;
  });
  try {
    const bytes = await storage.download(path);
    if (bytes.length > 5242880) throw badRequest("Bild höchstens 5 MiB.");
    const image = sharp(bytes, {
        limitInputPixels: 40_000_000,
        failOn: "warning",
      }),
      metadata = await image.metadata();
    if (
      !metadata.format ||
      !["jpeg", "png", "webp"].includes(metadata.format) ||
      (metadata.pages ?? 1) > 1
    )
      throw badRequest(
        "Bitte ein gültiges JPEG-, PNG- oder WebP-Bild hochladen.",
      );
    const [large, thumb] = await Promise.all([
      image
        .clone()
        .rotate()
        .resize({
          width: 2560,
          height: 2560,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 82 })
        .toBuffer(),
      image
        .clone()
        .rotate()
        .resize({
          width: 640,
          height: 480,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 78 })
        .toBuffer(),
    ]);
    const imagePath = `${user.id}/${listingId}/${imageId}.webp`,
      thumbnailPath = `${user.id}/${listingId}/${imageId}-thumb.webp`;
    await storage.put(imagePath, large);
    await storage.put(thumbnailPath, thumb);
    const { rows } = await ctx.db.query(
      "update cardanomix.listing_images set status='ready',image_path=$2,thumbnail_path=$3 where id=$1 and status='processing' returning id",
      [imageId, imagePath, thumbnailPath],
    );
    if (!rows.length) {
      await storage.remove("images", [imagePath, thumbnailPath]);
      throw conflict("Bild wurde während der Verarbeitung entfernt.");
    }
    await storage.remove("uploads", [path]);
  } catch (error) {
    await ctx.db.query(
      "update cardanomix.listing_images set status='pending' where id=$1 and status='processing'",
      [imageId],
    );
    if (error instanceof HttpError) throw error;
    throw badRequest(
      "Das Bild konnte nicht gelesen werden. Bitte eine andere Datei wählen.",
    );
  }
}
export async function imageUrls(
  ctx: AppContext,
  listingId: string,
): Promise<ListingImage[]> {
  const { rows } = await ctx.db.query<{
    id: string;
    position: number;
    image_path: string;
    thumbnail_path: string;
  }>(
    "select id,position,image_path,thumbnail_path from cardanomix.listing_images where listing_id=$1 and status='ready' order by position",
    [listingId],
  );
  if (!rows.length) return [];
  const urls = await storageFor(ctx).urls(
    rows.flatMap((row) => [row.image_path, row.thumbnail_path]),
  );
  return rows.map((row, i) => ({
    id: row.id,
    position: row.position,
    url: urls[i * 2],
    thumbnailUrl: urls[i * 2 + 1],
  }));
}
export async function deleteImage(
  ctx: AppContext,
  user: UserRow,
  listingId: string,
  imageId: string,
) {
  const rows = await ctx.db.transaction(async (tx) => {
    const listing = await listingRow(tx, listingId, true);
    requireOwner(listing, user);
    if (!["draft", "active", "paused"].includes(listing.status))
      throw conflict("Dieses Angebot kann nicht geändert werden.");
    const { rows } = await tx.query<{
      upload_path: string;
      image_path: string | null;
      thumbnail_path: string | null;
    }>(
      "update cardanomix.listing_images set status='deleted' where id=$1 and listing_id=$2 and owner_id=$3 returning upload_path,image_path,thumbnail_path",
      [imageId, listingId, user.id],
    );
    return rows;
  });
  if (!rows[0]) throw notFound("Bild nicht gefunden.");
  const storage = storageFor(ctx);
  await storage.remove("uploads", [rows[0].upload_path]);
  await storage.remove(
    "images",
    [rows[0].image_path, rows[0].thumbnail_path].filter(
      (p): p is string => !!p,
    ),
  );
}
export async function cleanUploads(ctx: AppContext) {
  // A signed upload URL remains valid after finalization. Remove originals recreated
  // with that URL only after its validity window has ended; keep checked images.
  const cutoff = new Date(ctx.now().getTime() - 86400000);
  const ready = await ctx.db.query<{ id: string; upload_path: string }>(
    "select id,upload_path from cardanomix.listing_images where status='ready' and upload_cleaned_at is null and created_at<$1 limit 50",
    [cutoff],
  );
  for (const row of ready.rows) {
    await storageFor(ctx).remove("uploads", [row.upload_path]);
    await ctx.db.query(
      "update cardanomix.listing_images set upload_cleaned_at=$2 where id=$1",
      [row.id, ctx.now()],
    );
  }
  const { rows } = await ctx.db.query<{
    id: string;
    upload_path: string;
    image_path: string | null;
    thumbnail_path: string | null;
  }>(
    "select id,upload_path,image_path,thumbnail_path from cardanomix.listing_images where status in ('pending','processing','deleted') and created_at<$1 limit 50",
    [new Date(ctx.now().getTime() - 86400000)],
  );
  for (const row of rows) {
    const claimed = await ctx.db.query(
      "update cardanomix.listing_images set status='deleted' where id=$1 and status in ('pending','processing','deleted') returning id",
      [row.id],
    );
    if (!claimed.rows.length) continue;
    const storage = storageFor(ctx);
    await storage.remove("uploads", [row.upload_path]);
    const base = row.upload_path.replace(/\.(jpg|png|webp)$/, "");
    await storage.remove("images", [
      row.image_path ?? `${base}.webp`,
      row.thumbnail_path ?? `${base}-thumb.webp`,
    ]);
    await ctx.db.query(
      "delete from cardanomix.listing_images where id=$1 and status in ('pending','processing','deleted')",
      [row.id],
    );
  }
  return rows.length;
}
