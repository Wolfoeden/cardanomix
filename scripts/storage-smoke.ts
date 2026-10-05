import sharp from "sharp";
import { createTestApi } from "../tests/helpers/api";
export async function run() {
  const api = await createTestApi({
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseSecret: process.env.SUPABASE_SECRET_KEY,
  });
  const seller = await api.login("storage-integration-only");
  let listingId: string | undefined, imageId: string | undefined;
  try {
    const made = await api.call("POST", "/api/listings", {
      cookie: seller.cookie,
      body: {
        title: "Storage validation fixture",
        description: "Temporary fixture kept in local database only.",
        category: "other",
        type: "goods",
        priceAda: "20",
        shippingAda: "0",
        delivery: "pickup",
        condition: "Gebraucht",
        location: "",
        terms: "",
        serviceScope: "",
        deliveryDays: 0,
      },
    });
    if (made.status !== 201) throw new Error("Fixture creation failed");
    listingId = made.body.listing.id;
    const pixels = await sharp({
      create: { width: 120, height: 80, channels: 3, background: "#234" },
    })
      .png()
      .toBuffer();
    const upload = await api.call("POST", `/api/listings/${listingId}/images`, {
      cookie: seller.cookie,
      body: { contentType: "image/png", size: pixels.length },
    });
    if (upload.status !== 201) throw new Error("Signed upload creation failed");
    imageId = upload.body.imageId;
    const put = await fetch(upload.body.uploadUrl, {
      method: "PUT",
      headers: { "content-type": "image/png" },
      body: new Uint8Array(pixels),
    });
    if (!put.ok) throw new Error(`Signed PUT failed: ${put.status}`);
    const processed = await api.call(
      "POST",
      `/api/listings/${listingId}/images/${imageId}/complete`,
      { cookie: seller.cookie },
    );
    if (processed.status !== 200) throw new Error("Image processing failed");
    const result = await api.call("GET", `/api/listings/${listingId}`, {
      cookie: seller.cookie,
    });
    const url = result.body.listing.images[0].url;
    const read = await fetch(url);
    if (!read.ok) throw new Error("Signed image URL failed");
    const meta = await sharp(
      new Uint8Array(await read.arrayBuffer()),
    ).metadata();
    if (meta.format !== "webp" || meta.exif)
      throw new Error("Checked image metadata invalid");
    console.log(
      JSON.stringify({
        passed: true,
        realSupabaseStorage: true,
        signedPut: true,
        signedRead: true,
        exifRemoved: true,
      }),
    );
  } finally {
    if (listingId && imageId)
      await api.call("DELETE", `/api/listings/${listingId}/images/${imageId}`, {
        cookie: seller.cookie,
      });
    await api.pg.close();
  }
}
