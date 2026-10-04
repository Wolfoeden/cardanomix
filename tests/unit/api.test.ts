import { describe, expect, it } from "vitest";
import { expireOverdueTrades } from "../../server/trades";
import { ADA, createTestApi, sellOffer } from "../helpers/api";
import { createTestWallet, utf8ToHex } from "../helpers/wallet";

describe("Öffentliche Endpunkte", () => {
  it("liefert Netzwerk, Kurse und Statistik", async () => {
    const api = await createTestApi();
    expect((await api.call("GET", "/api/config")).body).toEqual({ network: "mainnet", networkId: 1 });
    expect((await api.call("GET", "/api/prices")).body.prices.EUR.priceMicro).toBe(450_000);
    expect((await api.call("GET", "/api/stats")).body).toEqual({ activeOffers: 0, completedTrades: 0, traders: 0 });
    expect((await api.call("GET", "/api/gibts-nicht")).status).toBe(404);
    expect((await api.call("DELETE", "/api/config")).status).toBe(405);
    expect((await api.call("GET", "/api/offers/keine-uuid")).status).toBe(404);
    expect((await api.call("GET", "/api/health")).body).toEqual({
      ok: true,
      database: true,
      login: true,
      escrow: true,
      network: "mainnet",
    });
  });
});

describe("Anmeldung mit Wallet", () => {
  it("legt beim ersten Login ein Konto an und erkennt es wieder", async () => {
    const api = await createTestApi();
    const first = await api.login("alice");
    expect(first.user.identity).toBe(first.wallet.rewardAddress);
    expect(first.user.receiveAddress).toBe(first.wallet.baseAddress);
    expect(first.user.displayName).toMatch(/^Trader-[0-9a-f]{6}$/);
    const me = await api.call("GET", "/api/me", { cookie: first.cookie });
    expect(me.body.user.id).toBe(first.user.id);
    const again = await api.login("alice");
    expect(again.user.id).toBe(first.user.id);
    expect((await api.call("GET", "/api/me")).body.user).toBeNull();
  });

  it("verwendet eine Anmeldeanfrage nur einmal", async () => {
    const api = await createTestApi();
    const wallet = createTestWallet("replay");
    const challenge = await api.call("GET", "/api/auth/challenge");
    const signed = wallet.signData(wallet.rewardAddressHex, utf8ToHex(challenge.body.message));
    const body = { nonce: challenge.body.nonce, ...signed, receiveAddress: wallet.baseAddress };
    expect((await api.call("POST", "/api/auth/login", { body })).status).toBe(200);
    expect((await api.call("POST", "/api/auth/login", { body })).status).toBe(401);
  });

  it("lehnt falsche Signaturen, fremde Empfangsadressen und das falsche Netz ab", async () => {
    const api = await createTestApi();
    const wallet = createTestWallet("bob");
    const other = createTestWallet("mallory");

    let challenge = await api.call("GET", "/api/auth/challenge");
    let signed = wallet.signData(wallet.rewardAddressHex, utf8ToHex(`${challenge.body.message}!`));
    let result = await api.call("POST", "/api/auth/login", { body: { nonce: challenge.body.nonce, ...signed } });
    expect(result.status).toBe(401);

    challenge = await api.call("GET", "/api/auth/challenge");
    signed = wallet.signData(wallet.rewardAddressHex, utf8ToHex(challenge.body.message));
    result = await api.call("POST", "/api/auth/login", {
      body: { nonce: challenge.body.nonce, ...signed, receiveAddress: other.baseAddress },
    });
    expect(result.status).toBe(400);
    expect(result.body.error).toMatch(/gehört nicht/);

    const testnet = createTestWallet("bob", 0);
    challenge = await api.call("GET", "/api/auth/challenge");
    signed = testnet.signData(testnet.rewardAddressHex, utf8ToHex(challenge.body.message));
    result = await api.call("POST", "/api/auth/login", { body: { nonce: challenge.body.nonce, ...signed } });
    expect(result.body.code).toBe("wrong_network");
  });

  it("weist schreibende Anfragen von fremden Seiten ab", async () => {
    const api = await createTestApi();
    const { cookie } = await api.login("alice");
    const result = await api.call("POST", "/api/offers", { body: sellOffer, cookie, origin: "https://evil.example" });
    expect(result.status).toBe(403);
  });

  it("ohne SESSION_SECRET ist die Anmeldung gesperrt", async () => {
    const api = await createTestApi({ sessionSecret: null });
    const wallet = createTestWallet("x");
    const challenge = await api.call("GET", "/api/auth/challenge");
    const signed = wallet.signData(wallet.rewardAddressHex, utf8ToHex(challenge.body.message));
    const result = await api.call("POST", "/api/auth/login", { body: { nonce: challenge.body.nonce, ...signed } });
    expect(result.status).toBe(503);
    const health = await api.call("GET", "/api/health");
    expect(health.status).toBe(503);
    expect(health.body).toMatchObject({ ok: false, database: true, login: false, escrow: true });
  });

  it("ändert den Anzeigenamen und verhindert Dubletten", async () => {
    const api = await createTestApi();
    const alice = await api.login("alice");
    const bob = await api.login("bob");
    expect((await api.call("PATCH", "/api/me", { cookie: alice.cookie, body: { displayName: "Alice ADA" } })).status).toBe(200);
    expect((await api.call("PATCH", "/api/me", { cookie: bob.cookie, body: { displayName: "alice ada" } })).status).toBe(409);
    expect((await api.call("PATCH", "/api/me", { cookie: bob.cookie, body: { displayName: "<b>" } })).status).toBe(400);
  });
});

describe("Angebote", () => {
  it("prüft Eingaben und zeigt Angebote sortiert nach Preis", async () => {
    const api = await createTestApi();
    const maker = await api.login("maker");
    const other = await api.login("other");

    expect((await api.call("POST", "/api/offers", { body: sellOffer })).status).toBe(401);
    expect(
      (await api.call("POST", "/api/offers", { cookie: maker.cookie, body: { ...sellOffer, minFiat: "300" } })).body.error,
    ).toMatch(/Höchstbetrag/);
    expect(
      (await api.call("POST", "/api/offers", { cookie: maker.cookie, body: { ...sellOffer, paymentMethods: [] } })).status,
    ).toBe(400);

    const fixed = await api.call("POST", "/api/offers", { cookie: maker.cookie, body: sellOffer });
    expect(fixed.status).toBe(201);
    expect(fixed.body.offer.priceMicro).toBe(500_000);
    expect(fixed.body.offer.effectiveMaxFiatCents).toBe(25_000);

    const margin = await api.call("POST", "/api/offers", {
      cookie: other.cookie,
      body: { ...sellOffer, priceType: "margin", fixedPrice: undefined, marginPercent: 2 },
    });
    // 0,45 EUR Markt + 2 % = 0,459 EUR
    expect(margin.body.offer.priceMicro).toBe(459_000);

    const market = await api.call("GET", "/api/offers?side=sell&fiat=EUR");
    expect(market.body.offers.map((offer: { priceMicro: number }) => offer.priceMicro)).toEqual([459_000, 500_000]);
    expect((await api.call("GET", "/api/offers?side=buy")).body.offers).toHaveLength(0);
    expect((await api.call("GET", "/api/offers?side=sell&method=CASH")).body.offers).toHaveLength(0);
    expect((await api.call("GET", "/api/offers?side=sell&method=PAYPAL")).status).toBe(400);
    expect(
      (await api.call("POST", "/api/offers", { cookie: maker.cookie, body: { ...sellOffer, paymentMethods: ["PAYPAL"] } })).status,
    ).toBe(400);
    expect((await api.call("GET", "/api/offers?side=sell&amount=5")).body.offers).toHaveLength(0);
    expect((await api.call("GET", "/api/offers?side=sell&amount=100")).body.offers).toHaveLength(2);

    const paused = await api.call("PATCH", `/api/offers/${fixed.body.offer.id}`, {
      cookie: maker.cookie,
      body: { status: "paused" },
    });
    expect(paused.status).toBe(200);
    expect((await api.call("GET", "/api/offers?side=sell")).body.offers).toHaveLength(1);
    expect(
      (await api.call("PATCH", `/api/offers/${fixed.body.offer.id}`, { cookie: other.cookie, body: { status: "active" } })).status,
    ).toBe(403);
    expect((await api.call("GET", "/api/me/offers", { cookie: maker.cookie })).body.offers).toHaveLength(1);
  });
});

async function setupTrade(amount = "20", overrides = {}) {
  const api = await createTestApi(overrides);
  const seller = await api.login("seller");
  const buyer = await api.login("buyer");
  const offer = (await api.call("POST", "/api/offers", { cookie: seller.cookie, body: sellOffer })).body.offer;
  const started = await api.call("POST", `/api/offers/${offer.id}/trades`, {
    cookie: buyer.cookie,
    body: { amountType: "fiat", amount, paymentMethod: "SEPA" },
  });
  expect(started.status).toBe(201);
  return { api, seller, buyer, offer, tradeId: started.body.tradeId as string };
}

const view = async (api: Awaited<ReturnType<typeof createTestApi>>, cookie: string, tradeId: string) =>
  (await api.call("GET", `/api/trades/${tradeId}`, { cookie })).body.trade;

describe("Handelsablauf mit Treuhand", () => {
  it("Hinterlegung → Zahlung → Freigabe per Button → ADA beim Käufer → Bewertung", async () => {
    const { api, seller, buyer, offer, tradeId } = await setupTrade();

    let trade = await view(api, buyer.cookie, tradeId);
    expect(trade).toMatchObject({ status: "awaiting_escrow", role: "buyer", lovelace: 40 * ADA, fiatCents: 2_000, actions: ["cancel"] });
    expect(trade.escrow).toMatchObject({ status: "pending", requiredLovelace: 42 * ADA, fundedLovelace: 0, payoutTxHash: null });
    expect(trade.escrow.address).toMatch(/^addr1w/);
    expect(new Date(trade.escrow.refundAfter).getTime() - api.getNow().getTime()).toBe(14 * 86_400_000);
    expect((await view(api, seller.cookie, tradeId)).actions).toEqual(["fund_escrow", "cancel"]);
    expect((await api.call("GET", `/api/offers/${offer.id}`)).body.offer.availableLovelace).toBe(960 * ADA);

    // Vor der Hinterlegung kann der Käufer nicht „bezahlt“ melden, und nur der Verkäufer hinterlegt
    expect((await api.call("POST", `/api/trades/${tradeId}/paid`, { cookie: buyer.cookie })).status).toBe(409);
    expect(
      (
        await api.call("POST", `/api/trades/${tradeId}/escrow/deposit-tx`, {
          cookie: buyer.cookie,
          body: { utxos: ["00"], changeAddress: buyer.wallet.baseAddressHex },
        })
      ).status,
    ).toBe(409);

    api.advance(5);
    const funded = await api.deposit(seller, tradeId);
    expect(funded.status).toBe(200);
    expect(funded.body.trade).toMatchObject({ status: "awaiting_payment", escrow: { status: "funded", fundedLovelace: 42 * ADA } });
    expect(funded.body.trade.escrow.depositTxHash).toMatch(/^[0-9a-f]{64}$/);
    expect(api.ledger.balance(trade.escrow.address)).toBe(42 * ADA);
    // Die Zahlungsfrist (30 Minuten) beginnt erst mit der bestätigten Hinterlegung
    expect(new Date(funded.body.trade.paymentDeadline).getTime() - api.getNow().getTime()).toBe(30 * 60_000);

    expect((await api.call("POST", `/api/trades/${tradeId}/paid`, { cookie: buyer.cookie })).status).toBe(200);
    expect((await view(api, seller.cookie, tradeId)).actions).toEqual(["release", "dispute"]);
    // Der alte Weg (Tx-Hash melden, ADA direkt senden) ist bei Treuhand-Trades gesperrt
    const direct = await api.call("POST", `/api/trades/${tradeId}/release`, { cookie: seller.cookie, body: { txHash: "a".repeat(64) } });
    expect(direct.body.code).toBe("use_escrow");

    // Käufer darf nicht auszahlen, Verkäufer nicht zurückholen
    expect(
      (await api.call("POST", `/api/trades/${tradeId}/escrow/payout-tx`, { cookie: buyer.cookie, body: { kind: "release" } })).status,
    ).toBe(409);
    expect(
      (await api.call("POST", `/api/trades/${tradeId}/escrow/payout-tx`, { cookie: seller.cookie, body: { kind: "refund" } })).status,
    ).toBe(409);

    const buyerBefore = api.ledger.balance(buyer.wallet.baseAddress);
    const preview = await api.call("POST", `/api/trades/${tradeId}/escrow/payout-tx`, {
      cookie: seller.cookie,
      body: { kind: "release" },
    });
    expect(preview.body).toMatchObject({
      kind: "release",
      toAddress: buyer.wallet.baseAddress,
      toLovelace: 40 * ADA,
      changeAddress: seller.wallet.baseAddress,
    });
    expect(preview.body.changeLovelace + preview.body.fee).toBe(2 * ADA);

    const wrong = await api.call("POST", `/api/trades/${tradeId}/escrow/payout`, {
      cookie: seller.cookie,
      body: { witnessSet: createTestWallet("fremd").signTx(preview.body.txHex) },
    });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toMatch(/Schlüssel dieses Handels/);

    const released = await api.call("POST", `/api/trades/${tradeId}/escrow/payout`, {
      cookie: seller.cookie,
      body: { witnessSet: seller.wallet.signTx(preview.body.txHex) },
    });
    expect(released.status).toBe(200);
    expect(api.ledger.balance(buyer.wallet.baseAddress) - buyerBefore).toBe(40 * ADA);
    expect(api.ledger.balance(trade.escrow.address)).toBe(0);

    trade = (await api.call("POST", `/api/trades/${tradeId}/escrow/check`, { cookie: buyer.cookie })).body.trade;
    expect(trade).toMatchObject({
      status: "completed",
      completionNote: "escrow_release",
      escrow: { status: "released", payoutKind: "release", payoutTxHash: released.body.txHash },
      actions: ["rate"],
    });
    expect(
      (await api.call("POST", `/api/trades/${tradeId}/escrow/payout-tx`, { cookie: seller.cookie, body: { kind: "release" } })).status,
    ).toBe(409);

    expect(
      (await api.call("POST", `/api/trades/${tradeId}/rating`, { cookie: buyer.cookie, body: { positive: true, comment: "Top!" } }))
        .status,
    ).toBe(201);
    const profile = await api.call("GET", `/api/users/${seller.user.id}`);
    expect(profile.body.user.stats).toMatchObject({ completedTrades: 1, completionRate: 1, positiveRatings: 1 });
    const messages = (await api.call("GET", `/api/trades/${tradeId}`, { cookie: buyer.cookie })).body.messages;
    expect(messages.map((message: { body: string }) => message.body).join("\n")).toMatch(/Treuhand bestätigt[\s\S]*freigegeben[\s\S]*Auszahlung auf der Blockchain bestätigt/);
  });

  it("Abbruch vor der Hinterlegung und abgelaufene Hinterlegungsfrist", async () => {
    const { api, seller, buyer, offer, tradeId } = await setupTrade();
    expect((await api.call("POST", `/api/trades/${tradeId}/cancel`, { cookie: buyer.cookie })).status).toBe(200);
    expect((await api.call("GET", `/api/offers/${offer.id}`)).body.offer.availableLovelace).toBe(1_000 * ADA);

    const second = (
      await api.call("POST", `/api/offers/${offer.id}/trades`, {
        cookie: buyer.cookie,
        body: { amountType: "fiat", amount: "50", paymentMethod: "SEPA" },
      })
    ).body.tradeId;
    api.advance(60 + 10);
    expect(await expireOverdueTrades(api.ctx)).toBe(0); // Gnadenfrist läuft noch
    api.advance(10);
    expect(await expireOverdueTrades(api.ctx)).toBe(1);
    expect(await view(api, buyer.cookie, second)).toMatchObject({ status: "cancelled", cancelReason: "escrow_expired" });
    expect((await api.call("GET", `/api/users/${seller.user.id}`)).body.user.stats.cancelledTrades).toBe(1);
    expect((await api.call("GET", `/api/offers/${offer.id}`)).body.offer.availableLovelace).toBe(1_000 * ADA);
  });

  it("Zahlungsfrist abgelaufen: Verkäufer holt die ADA aus der Treuhand zurück", async () => {
    const { api, seller, buyer, tradeId } = await setupTrade();
    await api.deposit(seller, tradeId);
    api.advance(30 + 16);
    expect(await expireOverdueTrades(api.ctx)).toBe(1);
    const trade = await view(api, seller.cookie, tradeId);
    expect(trade).toMatchObject({ status: "cancelled", cancelReason: "expired", actions: ["refund"], escrow: { status: "funded" } });

    const before = api.ledger.balance(seller.wallet.baseAddress);
    const refunded = await api.payout(seller, tradeId, "refund");
    expect(refunded.status).toBe(200);
    expect(api.ledger.balance(seller.wallet.baseAddress) - before).toBeGreaterThan(41.5 * ADA);
    const after = (await api.call("POST", `/api/trades/${tradeId}/escrow/check`, { cookie: seller.cookie })).body.trade;
    expect(after.escrow.status).toBe("refunded");
    expect((await api.call("GET", `/api/users/${buyer.user.id}`)).body.user.stats.cancelledTrades).toBe(1);
  });

  it("verspätete Hinterlegung nach Abbruch kann zurückgeholt werden", async () => {
    const { api, seller, buyer, tradeId } = await setupTrade();
    const escrowAddress = (await view(api, seller.cookie, tradeId)).escrow.address;
    await api.call("POST", `/api/trades/${tradeId}/cancel`, { cookie: buyer.cookie });
    api.ledger.fund(escrowAddress, 42 * ADA); // z. B. manuell aus einer anderen Wallet gesendet
    const trade = (await api.call("POST", `/api/trades/${tradeId}/escrow/check`, { cookie: seller.cookie })).body.trade;
    expect(trade).toMatchObject({ status: "cancelled", escrow: { status: "funded" }, actions: ["refund"] });
    expect((await api.payout(seller, tradeId, "refund")).status).toBe(200);
  });

  it("Unbeteiligte sehen nichts und können nichts auslösen", async () => {
    const { api, seller, tradeId } = await setupTrade();
    await api.deposit(seller, tradeId);
    const stranger = await api.login("stranger");
    expect(
      (await api.call("POST", `/api/trades/${tradeId}/escrow/payout-tx`, { cookie: stranger.cookie, body: { kind: "release" } })).status,
    ).toBe(404);
    expect((await api.call("POST", `/api/trades/${tradeId}/escrow/check`, { cookie: stranger.cookie })).status).toBe(404);
  });

  it("setzt Limits durch", async () => {
    const { api, seller, buyer, offer } = await setupTrade();
    const third = await api.login("third");

    const own = await api.call("POST", `/api/offers/${offer.id}/trades`, {
      cookie: seller.cookie,
      body: { amountType: "fiat", amount: "20", paymentMethod: "SEPA" },
    });
    expect(own.body.code).toBe("own_offer");

    const tooBig = await api.call("POST", `/api/offers/${offer.id}/trades`, {
      cookie: third.cookie,
      body: { amountType: "fiat", amount: "249", paymentMethod: "SEPA" },
    });
    expect(tooBig.status).toBe(201); // unter 300 EUR erlaubt

    const method = await api.call("POST", `/api/offers/${offer.id}/trades`, {
      cookie: third.cookie,
      body: { amountType: "fiat", amount: "20", paymentMethod: "CASH" },
    });
    expect(method.status).toBe(400);

    const belowMin = await api.call("POST", `/api/offers/${offer.id}/trades`, {
      cookie: third.cookie,
      body: { amountType: "fiat", amount: "5", paymentMethod: "SEPA" },
    });
    expect(belowMin.body.error).toMatch(/Mindestbetrag/);

    // Neues-Konto-Limit greift bei einem Angebot mit hohem Höchstbetrag
    const big = (
      await api.call("POST", "/api/offers", { cookie: seller.cookie, body: { ...sellOffer, maxFiat: "1000" } })
    ).body.offer;
    const limited = await api.call("POST", `/api/offers/${big.id}/trades`, {
      cookie: third.cookie,
      body: { amountType: "fiat", amount: "301", paymentMethod: "SEPA" },
    });
    expect(limited.body.code).toBe("new_user_limit");

    // Höchstens drei offene Trades als Taker
    await api.call("POST", `/api/offers/${big.id}/trades`, { cookie: third.cookie, body: { amountType: "fiat", amount: "10", paymentMethod: "SEPA" } });
    await api.call("POST", `/api/offers/${big.id}/trades`, { cookie: third.cookie, body: { amountType: "fiat", amount: "10", paymentMethod: "SEPA" } });
    const fourth = await api.call("POST", `/api/offers/${big.id}/trades`, {
      cookie: third.cookie,
      body: { amountType: "fiat", amount: "10", paymentMethod: "SEPA" },
    });
    expect(fourth.body.code).toBe("too_many_trades");
    expect(buyer.user.id).toBeTruthy();
  });

  it("verbirgt Trades vor Unbeteiligten", async () => {
    const { api, tradeId } = await setupTrade();
    const stranger = await api.login("stranger");
    expect((await api.call("GET", `/api/trades/${tradeId}`, { cookie: stranger.cookie })).status).toBe(404);
    expect(
      (await api.call("POST", `/api/trades/${tradeId}/messages`, { cookie: stranger.cookie, body: { body: "hi" } })).status,
    ).toBe(404);
  });
});

describe("Streitfälle mit Treuhand", () => {
  async function disputedTrade() {
    const adminWallet = createTestWallet("admin");
    const { api, seller, buyer, tradeId } = await setupTrade("20", { adminIdentities: new Set([adminWallet.rewardAddress]) });
    const admin = await api.login("admin", adminWallet);
    expect(admin.user.isAdmin).toBe(true);
    await api.deposit(seller, tradeId);
    await api.call("POST", `/api/trades/${tradeId}/paid`, { cookie: buyer.cookie });
    expect((await api.call("POST", `/api/trades/${tradeId}/dispute`, { cookie: buyer.cookie, body: { reason: "kurz" } })).status).toBe(400);
    expect(
      (
        await api.call("POST", `/api/trades/${tradeId}/dispute`, {
          cookie: buyer.cookie,
          body: { reason: "Bezahlt, aber der Verkäufer gibt nicht frei." },
        })
      ).status,
    ).toBe(200);
    return { api, seller, buyer, admin, tradeId };
  }

  it("Entscheidung für den Käufer: Käufer holt die ADA ab, Verkäufer wird gesperrt", async () => {
    const { api, seller, buyer, admin, tradeId } = await disputedTrade();
    expect((await api.call("GET", "/api/admin/disputes", { cookie: seller.cookie })).status).toBe(403);
    expect((await api.call("GET", "/api/admin/disputes", { cookie: admin.cookie })).body.disputes).toHaveLength(1);
    expect(await view(api, admin.cookie, tradeId)).toMatchObject({ role: "admin", actions: ["resolve"] });
    // Moderation allein kann keine Auszahlung auslösen
    expect(
      (await api.call("POST", `/api/trades/${tradeId}/escrow/payout-tx`, { cookie: admin.cookie, body: { kind: "release" } })).status,
    ).toBe(409);

    const resolved = await api.call("POST", `/api/admin/trades/${tradeId}/resolve`, {
      cookie: admin.cookie,
      body: { outcome: "completed", fault: "seller", note: "Zahlung ist belegt, Verkäufer reagiert nicht.", banFaultUser: true },
    });
    expect(resolved.status).toBe(200);
    expect((await view(api, buyer.cookie, tradeId)).actions).toEqual(["claim", "rate"]);
    expect((await api.call("GET", "/api/me", { cookie: seller.cookie })).body.user).toBeNull();

    const before = api.ledger.balance(buyer.wallet.baseAddress);
    const claimed = await api.payout(buyer, tradeId, "release");
    expect(claimed.status).toBe(200);
    expect(api.ledger.balance(buyer.wallet.baseAddress) - before).toBe(40 * ADA);
    const trade = (await api.call("POST", `/api/trades/${tradeId}/escrow/check`, { cookie: buyer.cookie })).body.trade;
    expect(trade).toMatchObject({ status: "completed", completionNote: "admin", escrow: { status: "released" } });
  });

  it("Entscheidung für den Verkäufer: Rückzahlung", async () => {
    const { api, seller, admin, tradeId } = await disputedTrade();
    await api.call("POST", `/api/admin/trades/${tradeId}/resolve`, {
      cookie: admin.cookie,
      body: { outcome: "cancelled", fault: "buyer", note: "Keine Zahlung eingegangen.", banFaultUser: false },
    });
    expect((await view(api, seller.cookie, tradeId)).actions).toEqual(["refund"]);
    expect((await api.payout(seller, tradeId, "refund")).status).toBe(200);
  });
});

describe("Alter Ablauf ohne Treuhand", () => {
  it("bestehende Trades laufen mit Tx-Hash-Prüfung weiter", async () => {
    const { api, seller, buyer, offer, tradeId } = await setupTrade();
    const legacy = async (id: string) =>
      api.pg.query(
        "update trades set escrow = false, status = 'awaiting_payment', escrow_status = null, escrow_address = null where id = $1",
        [id],
      );
    await legacy(tradeId);
    expect(await view(api, buyer.cookie, tradeId)).toMatchObject({ escrow: null, actions: ["mark_paid", "cancel"] });
    await api.call("POST", `/api/trades/${tradeId}/paid`, { cookie: buyer.cookie });

    const short = api.ledger.fund(buyer.wallet.baseAddress, 39 * ADA);
    let release = await api.call("POST", `/api/trades/${tradeId}/release`, { cookie: seller.cookie, body: { txHash: short } });
    expect(release.body.verification.ok).toBe(false);
    const paid = api.ledger.fund(buyer.wallet.baseAddress, 40 * ADA);
    release = await api.call("POST", `/api/trades/${tradeId}/release`, { cookie: seller.cookie, body: { txHash: paid.toUpperCase() } });
    expect(release.body.trade).toMatchObject({ status: "completed", completionNote: "onchain", txHash: paid });

    const second = (
      await api.call("POST", `/api/offers/${offer.id}/trades`, {
        cookie: buyer.cookie,
        body: { amountType: "ada", amount: "80", paymentMethod: "WISE" },
      })
    ).body.tradeId;
    await legacy(second);
    await api.call("POST", `/api/trades/${second}/paid`, { cookie: buyer.cookie });
    const reuse = await api.call("POST", `/api/trades/${second}/release`, { cookie: seller.cookie, body: { txHash: paid } });
    expect(reuse.body.code).toBe("tx_reused");
  });
});

describe("Ohne Treuhand-Geheimnis", () => {
  it("startet keine Trades und meldet es im Health-Check", async () => {
    const api = await createTestApi({ arbiterSecret: null });
    const seller = await api.login("seller");
    const buyer = await api.login("buyer");
    const offer = (await api.call("POST", "/api/offers", { cookie: seller.cookie, body: sellOffer })).body.offer;
    const started = await api.call("POST", `/api/offers/${offer.id}/trades`, {
      cookie: buyer.cookie,
      body: { amountType: "fiat", amount: "20", paymentMethod: "SEPA" },
    });
    expect(started.status).toBe(503);
    expect(started.body.code).toBe("escrow_not_configured");
    const health = await api.call("GET", "/api/health");
    expect(health.status).toBe(503);
    expect(health.body).toMatchObject({ ok: false, escrow: false });
  });
});
