import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as CSL from "@emurgo/cardano-serialization-lib-nodejs";
import sharp from "sharp";
import { createTestApi, ADA } from "../helpers/api";
import { DEFAULT_FEE_ADDRESS } from "../../shared/marketplace";
import { MemoryImageStorage } from "../../dev/image-storage";
import {
  setImageStorage,
  cleanUploads,
} from "../../server/marketplace/storage";
import { reconcilePayments } from "../../server/marketplace/payments";
import { expireUnpaid } from "../../server/marketplace/orders";
const listing = {
  title: "Kamera mit Objektiv",
  description: "Gepflegte Kamera mit Objektiv und Ladegerät.",
  category: "electronics",
  type: "goods",
  priceAda: "20",
  shippingAda: "2",
  delivery: "shipping",
  condition: "Gebraucht",
  location: "Berlin",
  terms: "Versand innerhalb Deutschlands.",
  serviceScope: "",
  deliveryDays: 3,
};
describe("Marketplace boundaries and real transaction construction", () => {
  let api: Awaited<ReturnType<typeof createTestApi>>,
    seller: Awaited<ReturnType<typeof api.login>>,
    buyer: typeof seller,
    other: typeof seller,
    storage: MemoryImageStorage;
  beforeEach(async () => {
    api = await createTestApi();
    storage = new MemoryImageStorage();
    setImageStorage(api.ctx, storage);
    seller = await api.login("market-seller");
    buyer = await api.login("market-buyer");
    other = await api.login("market-other");
  });
  afterEach(async () => {
    await api.pg.close();
  });
  it("blocks a minimum-ADA violation without increasing the fixed platform fee", async () => {
    const o = await order(await publish());
    api.ledger.fund(buyer.wallet.baseAddress, 100 * ADA);
    const previous = api.ctx.fetch;
    api.ctx.fetch = (async (input, init) =>
      String(input).endsWith("/cli_protocol_params")
        ? Response.json({
            txFeePerByte: 44,
            txFeeFixed: 155381,
            utxoCostPerByte: 500000,
            maxTxSize: 16384,
            maxValueSize: 5000,
            stakeAddressDeposit: 2000000,
            stakePoolDeposit: 500000000,
          })
        : previous(input, init)) as typeof fetch;
    const result = await api.call("POST", `/api/orders/${o.id}/payment-tx`, {
      cookie: buyer.cookie,
      body: {
        utxos: api.ledger
          .utxosAt(buyer.wallet.baseAddress)
          .map((u) => u.outputHex),
        changeAddress: buyer.wallet.baseAddressHex,
      },
    });
    expect(result.status).toBe(400);
    expect(result.body.error).toContain("Mindest-ADA");
    expect(
      (await api.pg.query("select count(*) from cardanomix.order_payments"))
        .rows[0],
    ).toEqual({ count: 0 });
  });
  it("keeps a separate exact fee output even when seller and platform addresses coincide", async () => {
    api.ctx.config.feeAddress = seller.wallet.baseAddress;
    const o = await order(await publish()),
      p = await prepare(o.id),
      outputs = CSL.FixedTransaction.from_hex(p.txHex).body().outputs();
    const amounts = [];
    for (let i = 0; i < outputs.len(); i++) {
      const out = outputs.get(i);
      if (out.address().to_bech32(undefined) === seller.wallet.baseAddress)
        amounts.push(Number(out.amount().coin().to_str()));
    }
    expect(amounts.sort((a, b) => a - b)).toEqual([ADA, 22 * ADA]);
  });
  it("holds expired prepared payments when the blockchain index is stale", async () => {
    const id = await publish(),
      o = await order(id);
    await prepare(o.id);
    api.advance(22);
    const previous = api.ctx.fetch;
    api.ctx.fetch = (async (input, init) =>
      String(input).endsWith("/tip")
        ? Response.json([
            {
              abs_slot: 999999999,
              block_time: api.getNow().getTime() / 1000 - 1000,
            },
          ])
        : previous(input, init)) as typeof fetch;
    await reconcilePayments(api.ctx);
    expect(
      (await api.call("GET", `/api/listings/${id}`)).body.listing.status,
    ).toBe("reserved");
    api.ctx.fetch = previous;
    api.advance(1);
    await reconcilePayments(api.ctx);
    expect(
      (await api.call("GET", `/api/listings/${id}`)).body.listing.status,
    ).toBe("active");
  });
  it("removes originals recreated with a signed URL without deleting checked images", async () => {
    const id = await publish(),
      upload = await api.call("POST", `/api/listings/${id}/images`, {
        cookie: seller.cookie,
        body: { contentType: "image/png", size: 50 },
      });
    const path = storage.tokens.get(upload.body.uploadUrl.split("/").pop())!;
    const pixels = await sharp({
      create: { width: 20, height: 20, channels: 3, background: "#234" },
    })
      .png()
      .toBuffer();
    storage.uploads.set(path, pixels);
    expect(
      (
        await api.call(
          "POST",
          `/api/listings/${id}/images/${upload.body.imageId}/complete`,
          { cookie: seller.cookie },
        )
      ).status,
    ).toBe(200);
    storage.uploads.set(path, pixels);
    api.advance(24 * 60 + 1);
    await cleanUploads(api.ctx);
    expect(storage.uploads.has(path)).toBe(false);
    expect(storage.images.size).toBe(2);
    expect(
      (await api.call("GET", `/api/listings/${id}`)).body.listing.images,
    ).toHaveLength(1);
  });
  it("holds prepared transactions through timeout, blocks cancellation and reconciles external broadcasts", async () => {
    const id = await publish(),
      o = await order(id),
      p = await prepare(o.id);
    expect(
      (
        await api.call("POST", `/api/orders/${o.id}/action`, {
          cookie: buyer.cookie,
          body: { action: "cancel" },
        })
      ).status,
    ).toBe(409);
    const fixed = CSL.FixedTransaction.from_hex(p.txHex),
      witnesses = CSL.TransactionWitnessSet.from_hex(
        buyer.wallet.signTx(p.txHex),
      ).vkeys()!;
    for (let i = 0; i < witnesses.len(); i++)
      fixed.add_vkey_witness(witnesses.get(i));
    api.ledger.submit(fixed.to_bytes());
    api.advance(16);
    await expireUnpaid(api.ctx);
    await reconcilePayments(api.ctx);
    expect(
      (await api.call("GET", `/api/orders/${o.id}`, { cookie: buyer.cookie }))
        .body.order.status,
    ).toBe("paid");
    expect(
      (await api.call("GET", `/api/listings/${id}`)).body.listing.status,
    ).toBe("sold");
  });
  it("releases an unsigned prepared transaction only after a fresh chain tip passes its TTL", async () => {
    const id = await publish(),
      o = await order(id);
    await prepare(o.id);
    api.advance(16);
    await expireUnpaid(api.ctx);
    await reconcilePayments(api.ctx);
    expect(
      (await api.call("GET", `/api/listings/${id}`)).body.listing.status,
    ).toBe("reserved");
    api.advance(6);
    await reconcilePayments(api.ctx);
    expect(
      (await api.call("GET", `/api/orders/${o.id}`, { cookie: buyer.cookie }))
        .body.order.status,
    ).toBe("expired");
  });
  async function publish() {
    const made = await api.call("POST", "/api/listings", {
      cookie: seller.cookie,
      body: listing,
    });
    expect(made.status).toBe(201);
    const id = made.body.listing.id;
    expect(
      (
        await api.call("PATCH", `/api/listings/${id}`, {
          cookie: seller.cookie,
          body: { status: "active" },
        })
      ).status,
    ).toBe(200);
    return id;
  }
  async function order(id: string) {
    const result = await api.call("POST", `/api/listings/${id}/orders`, {
      cookie: buyer.cookie,
      body: { deliveryDetails: "Test Buyer, Teststraße 1, 12345 Berlin" },
    });
    expect(result.status).toBe(201);
    return result.body.order;
  }
  async function prepare(id: string) {
    api.ledger.fund(buyer.wallet.baseAddress, 100 * ADA);
    const result = await api.call("POST", `/api/orders/${id}/payment-tx`, {
      cookie: buyer.cookie,
      body: {
        utxos: api.ledger
          .utxosAt(buyer.wallet.baseAddress)
          .map((u) => u.outputHex),
        changeAddress: buyer.wallet.baseAddressHex,
      },
    });
    expect(result.status).toBe(200);
    return result.body;
  }
  it("keeps drafts private, checks ownership and separates existing ADA offers", async () => {
    const made = await api.call("POST", "/api/listings", {
        cookie: seller.cookie,
        body: listing,
      }),
      id = made.body.listing.id;
    expect((await api.call("GET", `/api/listings/${id}`)).status).toBe(404);
    expect(
      (await api.call("GET", `/api/listings/${id}`, { cookie: other.cookie }))
        .status,
    ).toBe(404);
    expect(
      (
        await api.call("PUT", `/api/listings/${id}`, {
          cookie: other.cookie,
          body: listing,
        })
      ).status,
    ).toBe(403);
    expect((await api.call("GET", "/api/listings")).body.listings).toEqual([]);
    expect((await api.call("GET", "/api/offers")).body.offers).toEqual([]);
  });
  it("validates prices, delivery and service scope", async () => {
    for (const patch of [
      { priceAda: "0.1" },
      { shippingAda: "-1" },
      {
        type: "service",
        delivery: "digital",
        shippingAda: "0",
        serviceScope: "",
      },
      { type: "digital", delivery: "shipping" },
    ])
      expect(
        (
          await api.call("POST", "/api/listings", {
            cookie: seller.cookie,
            body: { ...listing, ...patch },
          })
        ).status,
      ).toBe(400);
  });
  it("atomically reserves one unit and snapshots seller address, price and private delivery details", async () => {
    const id = await publish();
    const results = await Promise.all([
      api.call("POST", `/api/listings/${id}/orders`, {
        cookie: buyer.cookie,
        body: { deliveryDetails: "Address buyer, Berlin, Germany" },
      }),
      api.call("POST", `/api/listings/${id}/orders`, {
        cookie: other.cookie,
        body: { deliveryDetails: "Address other, Berlin, Germany" },
      }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const o = results.find((r) => r.status === 201)!.body.order;
    expect(o).toMatchObject({
      priceLovelace: 20 * ADA,
      shippingLovelace: 2 * ADA,
      feeLovelace: ADA,
      sellerAddress: seller.wallet.baseAddress,
      feeAddress: DEFAULT_FEE_ADDRESS,
    });
    expect(
      (
        await api.call("PUT", `/api/listings/${id}`, {
          cookie: seller.cookie,
          body: { ...listing, priceAda: "200" },
        })
      ).status,
    ).toBe(409);
    expect((await api.call("GET", `/api/orders/${o.id}`)).status).toBe(401);
    const outsider = o.buyerId === buyer.user.id ? other : buyer;
    expect(
      (
        await api.call("GET", `/api/orders/${o.id}`, {
          cookie: outsider.cookie,
        })
      ).status,
    ).toBe(403);
  });
  it("builds and signs a genuine transaction with exact seller and platform outputs", async () => {
    const id = await publish(),
      o = await order(id),
      p = await prepare(o.id);
    const fixed = CSL.FixedTransaction.from_hex(p.txHex),
      outputs = fixed.body().outputs();
    const values = new Map<string, number>();
    for (let i = 0; i < outputs.len(); i++) {
      const out = outputs.get(i);
      values.set(
        out.address().to_bech32(undefined),
        Number(out.amount().coin().to_str()),
      );
    }
    expect(values.get(seller.wallet.baseAddress)).toBe(22 * ADA);
    expect(values.get(DEFAULT_FEE_ADDRESS)).toBe(ADA);
    expect(p.txHash).toBe(fixed.transaction_hash().to_hex());
    expect(p.networkFeeLovelace).toBeGreaterThan(0);
    expect(
      (
        await api.call("POST", `/api/orders/${o.id}/payment`, {
          cookie: buyer.cookie,
          body: { txHash: p.txHash, witnessSet: buyer.wallet.signTx(p.txHex) },
        })
      ).status,
    ).toBe(200);
    await api.call("POST", `/api/orders/${o.id}/check`, {
      cookie: buyer.cookie,
    });
    expect(api.ledger.balance(seller.wallet.baseAddress)).toBe(22 * ADA);
    expect(api.ledger.balance(DEFAULT_FEE_ADDRESS)).toBe(ADA);
    expect(
      (await api.call("GET", `/api/orders/${o.id}`, { cookie: buyer.cookie }))
        .body.order.status,
    ).toBe("paid");
    expect(
      (await api.call("GET", `/api/listings/${id}`)).body.listing.status,
    ).toBe("sold");
    expect(
      (
        await api.call("POST", `/api/orders/${o.id}/action`, {
          cookie: seller.cookie,
          body: { action: "fulfill", note: "Tracking: TEST123" },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await api.call("POST", `/api/orders/${o.id}/action`, {
          cookie: buyer.cookie,
          body: { action: "complete" },
        })
      ).body.order.status,
    ).toBe("completed");
  });
  it("rejects wrong signatures, altered fee bodies and reused payment hashes", async () => {
    const o = await order(await publish()),
      p = await prepare(o.id);
    const body = CSL.FixedTransaction.from_hex(p.txHex).body();
    const altered = CSL.TransactionBody.new_tx_body(
      body.inputs(),
      body.outputs(),
      CSL.BigNum.from_str("999999"),
    );
    const modified = CSL.FixedTransaction.new_from_body_bytes(
      altered.to_bytes(),
    ).to_hex();
    expect(
      (
        await api.call("POST", `/api/orders/${o.id}/payment`, {
          cookie: buyer.cookie,
          body: { txHash: p.txHash, witnessSet: buyer.wallet.signTx(modified) },
        })
      ).status,
    ).toBe(400);
    const bad = await api.call("POST", `/api/orders/${o.id}/payment`, {
      cookie: buyer.cookie,
      body: { txHash: p.txHash, witnessSet: other.wallet.signTx(p.txHex) },
    });
    expect(bad.status).toBe(400);
    expect(
      (
        await api.call("POST", `/api/orders/${o.id}/payment`, {
          cookie: buyer.cookie,
          body: {
            txHash: "a".repeat(64),
            witnessSet: buyer.wallet.signTx(p.txHex),
          },
        })
      ).status,
    ).toBe(400);
    expect(api.ledger.submitted).toHaveLength(0);
  });
  it("does not accept forged UTxO values, another wallet's change or a mainnet fee address on Preprod", async () => {
    const o = await order(await publish());
    api.ledger.fund(buyer.wallet.baseAddress, 100 * ADA);
    const utxos = api.ledger
      .utxosAt(buyer.wallet.baseAddress)
      .map((u) => u.outputHex);
    expect(
      (
        await api.call("POST", `/api/orders/${o.id}/payment-tx`, {
          cookie: buyer.cookie,
          body: { utxos, changeAddress: other.wallet.baseAddressHex },
        })
      ).status,
    ).toBe(400);
    const u = CSL.TransactionUnspentOutput.from_hex(utxos[0]),
      fake = CSL.TransactionUnspentOutput.new(
        u.input(),
        CSL.TransactionOutput.new(
          u.output().address(),
          CSL.Value.new(CSL.BigNum.from_str("999000000")),
        ),
      );
    expect(
      (
        await api.call("POST", `/api/orders/${o.id}/payment-tx`, {
          cookie: buyer.cookie,
          body: {
            utxos: [fake.to_hex()],
            changeAddress: buyer.wallet.baseAddressHex,
          },
        })
      ).status,
    ).toBe(400);
    api.ctx.config.network = "preprod";
    const id = await publish();
    expect(
      (
        await api.call("POST", `/api/listings/${id}/orders`, {
          cookie: buyer.cookie,
          body: { deliveryDetails: "Test Address, Berlin Germany" },
        })
      ).status,
    ).toBe(400);
  });
  it("retains reservations below ten confirmations and after a network timeout", async () => {
    const id = await publish(),
      o = await order(id),
      p = await prepare(o.id);
    api.ledger.confirmationCount = 3;
    const realFetch = api.ctx.fetch;
    api.ctx.fetch = (async (input, init) => {
      if (String(input).endsWith("/submittx")) {
        await realFetch(input, init);
        throw new Error("timeout after acceptance");
      }
      return realFetch(input, init);
    }) as typeof fetch;
    expect(
      (
        await api.call("POST", `/api/orders/${o.id}/payment`, {
          cookie: buyer.cookie,
          body: { txHash: p.txHash, witnessSet: buyer.wallet.signTx(p.txHex) },
        })
      ).status,
    ).toBe(502);
    api.ctx.fetch = realFetch;
    expect(
      (
        await api.call("POST", `/api/orders/${o.id}/check`, {
          cookie: buyer.cookie,
        })
      ).body.order.status,
    ).toBe("payment_pending");
    expect(
      (
        await api.call("POST", `/api/orders/${o.id}/action`, {
          cookie: buyer.cookie,
          body: { action: "cancel" },
        })
      ).status,
    ).toBe(409);
    api.advance(30);
    await expireUnpaid(api.ctx);
    expect(
      (await api.call("GET", `/api/listings/${id}`)).body.listing.status,
    ).toBe("reserved");
    api.ledger.confirmationCount = 10;
    expect(
      (
        await api.call("POST", `/api/orders/${o.id}/check`, {
          cookie: buyer.cookie,
        })
      ).body.order.status,
    ).toBe("paid");
    expect(api.ledger.submitted).toHaveLength(1);
  });
  it("expires unprepared reservations without hiding late payments behind a clock timeout", async () => {
    const id = await publish(),
      o = await order(id);
    api.advance(16);
    await expireUnpaid(api.ctx);
    expect(
      (await api.call("GET", `/api/orders/${o.id}`, { cookie: buyer.cookie }))
        .body.order.status,
    ).toBe("expired");
    expect(
      (await api.call("GET", `/api/listings/${id}`)).body.listing.status,
    ).toBe("active");
  });
  it("validates and converts uploaded pixels, keeps private drafts hidden and checks image ownership", async () => {
    const made = await api.call("POST", "/api/listings", {
        cookie: seller.cookie,
        body: listing,
      }),
      id = made.body.listing.id;
    expect(
      (
        await api.call("POST", `/api/listings/${id}/images`, {
          cookie: other.cookie,
          body: { contentType: "image/png", size: 20 },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await api.call("POST", `/api/listings/${id}/images`, {
          cookie: seller.cookie,
          body: { contentType: "image/svg+xml", size: 20 },
        })
      ).status,
    ).toBe(400);
    const upload = await api.call("POST", `/api/listings/${id}/images`, {
      cookie: seller.cookie,
      body: { contentType: "image/png", size: 100 },
    });
    expect(upload.status).toBe(201);
    const path = storage.tokens.get(upload.body.uploadUrl.split("/").pop())!;
    storage.uploads.set(
      path,
      await sharp({
        create: { width: 120, height: 80, channels: 3, background: "#265ee9" },
      })
        .png()
        .toBuffer(),
    );
    expect(
      (
        await api.call(
          "POST",
          `/api/listings/${id}/images/${upload.body.imageId}/complete`,
          { cookie: seller.cookie },
        )
      ).status,
    ).toBe(200);
    const result = await api.call("GET", `/api/listings/${id}`, {
      cookie: seller.cookie,
    });
    expect(result.body.listing.images).toHaveLength(1);
    const image = Array.from(storage.images.values())[0];
    expect((await sharp(image).metadata()).format).toBe("webp");
    expect((await sharp(image).metadata()).exif).toBeUndefined();
    expect(
      (await api.call("GET", `/api/listings/${id}`, { cookie: buyer.cookie }))
        .status,
    ).toBe(404);
    expect(
      (
        await api.call(
          "DELETE",
          `/api/listings/${id}/images/${upload.body.imageId}`,
          { cookie: buyer.cookie },
        )
      ).status,
    ).toBe(403);
  });
  it("refuses corrupt pixels and limits uploads to ten", async () => {
    const id = await publish();
    for (let i = 0; i < 10; i++)
      expect(
        (
          await api.call("POST", `/api/listings/${id}/images`, {
            cookie: seller.cookie,
            body: { contentType: "image/png", size: 20 },
          })
        ).status,
      ).toBe(201);
    expect(
      (
        await api.call("POST", `/api/listings/${id}/images`, {
          cookie: seller.cookie,
          body: { contentType: "image/png", size: 20 },
        })
      ).status,
    ).toBe(409);
    const entry = Array.from(storage.tokens.entries())[0];
    storage.uploads.set(entry[1], new TextEncoder().encode("not a PNG"));
    const imageId = entry[1].split("/").pop()!.split(".")[0];
    expect(
      (
        await api.call(
          "POST",
          `/api/listings/${id}/images/${imageId}/complete`,
          { cookie: seller.cookie },
        )
      ).status,
    ).toBe(400);
    expect(
      (await api.call("GET", `/api/listings/${id}`)).body.listing.images,
    ).toEqual([]);
  });
  it("isolates chats and prevents unrelated users from reading messages", async () => {
    const id = await publish(),
      contact = await api.call("POST", `/api/listings/${id}/conversation`, {
        cookie: buyer.cookie,
      }),
      c = contact.body.conversationId;
    expect(
      (
        await api.call("POST", `/api/conversations/${c}/messages`, {
          cookie: buyer.cookie,
          body: { body: "Ist die Kamera noch verfügbar?" },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await api.call("GET", `/api/conversations/${c}/messages`, {
          cookie: seller.cookie,
        })
      ).body.messages[0].body,
    ).toContain("Kamera");
    expect(
      (
        await api.call("GET", `/api/conversations/${c}/messages`, {
          cookie: other.cookie,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await api.call("POST", `/api/conversations/${c}/messages`, {
          cookie: other.cookie,
          body: { body: "intrusion" },
        })
      ).status,
    ).toBe(403);
  });
  it("exposes reports only to moderator wallets and hides moderated listings", async () => {
    const id = await publish();
    await api.call("POST", `/api/listings/${id}/report`, {
      cookie: buyer.cookie,
      body: { reason: "Verdächtiges Angebot prüfen" },
    });
    expect(
      (await api.call("GET", "/api/admin/reports", { cookie: buyer.cookie }))
        .status,
    ).toBe(403);
    api.ctx.config.adminIdentities.add(other.wallet.rewardAddress);
    const result = await api.call("GET", "/api/admin/reports", {
      cookie: other.cookie,
    });
    expect(result.body.reports).toHaveLength(1);
    expect(
      (
        await api.call(
          "POST",
          `/api/admin/reports/${result.body.reports[0].id}`,
          { cookie: other.cookie, body: { action: "hide" } },
        )
      ).status,
    ).toBe(200);
    expect((await api.call("GET", `/api/listings/${id}`)).status).toBe(404);
  });
  it("keeps schema isolation and denies backend access to other application schemas", async () => {
    expect(
      (
        await api.pg.query(
          "select count(*) from pg_tables where schemaname='cardanomix'",
        )
      ).rows[0],
    ).toEqual({ count: 13 });
    await api.pg.exec("set role cardanomix_backend");
    await expect(
      api.pg.query("select count(*) from cardanomix.listings"),
    ).resolves.toBeDefined();
    await expect(
      api.pg.query("create table public.outside_access(id int)"),
    ).rejects.toThrow();
    await api.pg.exec("reset role");
  });
});
