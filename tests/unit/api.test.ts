import { describe, expect, it } from "vitest";
import { createTestApi, sellOffer } from "../helpers/api";
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
    expect((await api.call("GET", "/api/health")).body).toEqual({ ok: true, database: true, login: true, network: "mainnet" });
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
    expect(health.body).toMatchObject({ ok: false, database: true, login: false });
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

async function setupTrade(amount = "20") {
  const api = await createTestApi();
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

describe("Handelsablauf", () => {
  it("läuft vom Start bis zur On-Chain-Bestätigung und Bewertung", async () => {
    const { api, seller, buyer, offer, tradeId } = await setupTrade();

    let detail = await api.call("GET", `/api/trades/${tradeId}`, { cookie: buyer.cookie });
    expect(detail.body.trade).toMatchObject({
      status: "awaiting_payment",
      role: "buyer",
      lovelace: 40_000_000, // 20 EUR / 0,50 EUR
      fiatCents: 2_000,
      buyerAddress: buyer.wallet.baseAddress,
      actions: ["mark_paid", "cancel"],
      terms: sellOffer.terms,
    });
    expect(detail.body.messages[0].senderId).toBeNull();
    expect((await api.call("GET", `/api/offers/${offer.id}`)).body.offer.availableLovelace).toBe(960_000_000);

    // Verkäufer darf vor Fristablauf weder abbrechen noch freigeben
    expect((await api.call("POST", `/api/trades/${tradeId}/cancel`, { cookie: seller.cookie })).status).toBe(409);
    expect((await api.call("POST", `/api/trades/${tradeId}/paid`, { cookie: seller.cookie })).status).toBe(409);

    expect((await api.call("POST", `/api/trades/${tradeId}/paid`, { cookie: buyer.cookie })).status).toBe(200);
    expect((await api.call("POST", `/api/trades/${tradeId}/paid`, { cookie: buyer.cookie })).status).toBe(409);

    await api.call("POST", `/api/trades/${tradeId}/messages`, { cookie: seller.cookie, body: { body: "Zahlung ist da, sende jetzt." } });

    const hash = "b".repeat(64);
    // Erst zu wenig, dann korrekt
    api.chain.set(hash, { hash, address: buyer.wallet.baseAddress, lovelace: 39_000_000, timestamp: api.getNow().getTime() / 1000 + 30 });
    let release = await api.call("POST", `/api/trades/${tradeId}/release`, { cookie: seller.cookie, body: { txHash: hash } });
    expect(release.body.verification.ok).toBe(false);
    expect(release.body.trade.status).toBe("paid");

    api.chain.set(hash, { hash, address: buyer.wallet.baseAddress, lovelace: 40_000_000, timestamp: api.getNow().getTime() / 1000 + 30 });
    release = await api.call("POST", `/api/trades/${tradeId}/release`, { cookie: seller.cookie, body: { txHash: hash.toUpperCase() } });
    expect(release.body.verification.ok).toBe(true);
    expect(release.body.trade).toMatchObject({ status: "completed", completionNote: "onchain", txHash: hash, actions: ["rate"] });

    expect((await api.call("POST", `/api/trades/${tradeId}/rating`, { cookie: buyer.cookie, body: { positive: true, comment: "Top!" } })).status).toBe(201);
    expect((await api.call("POST", `/api/trades/${tradeId}/rating`, { cookie: buyer.cookie, body: { positive: true } })).status).toBe(409);

    detail = await api.call("GET", `/api/trades/${tradeId}?after=1`, { cookie: seller.cookie });
    expect(detail.body.trade.ratings).toHaveLength(1);
    expect(detail.body.messages.every((message: { id: number }) => message.id > 1)).toBe(true);

    const profile = await api.call("GET", `/api/users/${seller.user.id}`);
    expect(profile.body.user.stats).toMatchObject({ completedTrades: 1, completionRate: 1, positiveRatings: 1 });
    expect(profile.body.ratings[0].comment).toBe("Top!");
    expect((await api.call("GET", "/api/stats")).body.completedTrades).toBe(1);
  });

  it("verhindert, dass ein Tx-Hash zweimal verwendet wird", async () => {
    const { api, seller, buyer, offer, tradeId } = await setupTrade();
    await api.call("POST", `/api/trades/${tradeId}/paid`, { cookie: buyer.cookie });
    const hash = "c".repeat(64);
    api.chain.set(hash, { hash, address: buyer.wallet.baseAddress, lovelace: 40_000_000, timestamp: api.getNow().getTime() / 1000 });
    await api.call("POST", `/api/trades/${tradeId}/release`, { cookie: seller.cookie, body: { txHash: hash } });

    const second = await api.call("POST", `/api/offers/${offer.id}/trades`, {
      cookie: buyer.cookie,
      body: { amountType: "ada", amount: "80", paymentMethod: "WISE" },
    });
    await api.call("POST", `/api/trades/${second.body.tradeId}/paid`, { cookie: buyer.cookie });
    const reuse = await api.call("POST", `/api/trades/${second.body.tradeId}/release`, { cookie: seller.cookie, body: { txHash: hash } });
    expect(reuse.status).toBe(409);
    expect(reuse.body.code).toBe("tx_reused");
  });

  it("gibt die Menge beim Abbruch zurück und bricht überfällige Trades automatisch ab", async () => {
    const { api, seller, buyer, offer, tradeId } = await setupTrade();
    expect((await api.call("POST", `/api/trades/${tradeId}/cancel`, { cookie: buyer.cookie })).status).toBe(200);
    expect((await api.call("GET", `/api/offers/${offer.id}`)).body.offer.availableLovelace).toBe(1_000_000_000);

    const next = await api.call("POST", `/api/offers/${offer.id}/trades`, {
      cookie: buyer.cookie,
      body: { amountType: "fiat", amount: "50", paymentMethod: "SEPA" },
    });
    api.setNow(new Date(api.getNow().getTime() + 31 * 60_000));
    const detail = await api.call("GET", `/api/trades/${next.body.tradeId}`, { cookie: seller.cookie });
    expect(detail.body.trade.actions).toEqual(["cancel"]);

    const { expireOverdueTrades } = await import("../../server/trades");
    expect(await expireOverdueTrades(api.ctx)).toBe(0); // Gnadenfrist läuft noch
    api.setNow(new Date(api.getNow().getTime() + 15 * 60_000));
    expect(await expireOverdueTrades(api.ctx)).toBe(1);
    expect((await api.call("GET", `/api/offers/${offer.id}`)).body.offer.availableLovelace).toBe(1_000_000_000);

    const stats = (await api.call("GET", `/api/users/${buyer.user.id}`)).body.user.stats;
    expect(stats).toMatchObject({ cancelledTrades: 2, completionRate: 0 });
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

describe("Streitfälle", () => {
  it("lässt Admins entscheiden und den Betrüger sperren", async () => {
    const adminWallet = createTestWallet("admin");
    const api = await createTestApi({ adminIdentities: new Set([adminWallet.rewardAddress]) });
    const seller = await api.login("seller");
    const buyer = await api.login("buyer");
    const admin = await api.login("admin", adminWallet);
    expect(admin.user.isAdmin).toBe(true);

    const offer = (await api.call("POST", "/api/offers", { cookie: seller.cookie, body: sellOffer })).body.offer;
    const tradeId = (
      await api.call("POST", `/api/offers/${offer.id}/trades`, {
        cookie: buyer.cookie,
        body: { amountType: "fiat", amount: "20", paymentMethod: "SEPA" },
      })
    ).body.tradeId;
    await api.call("POST", `/api/trades/${tradeId}/paid`, { cookie: buyer.cookie });

    expect((await api.call("POST", `/api/trades/${tradeId}/dispute`, { cookie: buyer.cookie, body: { reason: "kurz" } })).status).toBe(400);
    expect(
      (await api.call("POST", `/api/trades/${tradeId}/dispute`, { cookie: buyer.cookie, body: { reason: "Bezahlt, aber keine ADA erhalten." } })).status,
    ).toBe(200);

    expect((await api.call("GET", "/api/admin/disputes", { cookie: seller.cookie })).status).toBe(403);
    const disputes = await api.call("GET", "/api/admin/disputes", { cookie: admin.cookie });
    expect(disputes.body.disputes).toHaveLength(1);

    const adminView = await api.call("GET", `/api/trades/${tradeId}`, { cookie: admin.cookie });
    expect(adminView.body.trade).toMatchObject({ role: "admin", actions: ["resolve"] });
    await api.call("POST", `/api/trades/${tradeId}/messages`, { cookie: admin.cookie, body: { body: "Bitte Belege hochladen." } });

    const resolved = await api.call("POST", `/api/admin/trades/${tradeId}/resolve`, {
      cookie: admin.cookie,
      body: { outcome: "cancelled", fault: "seller", note: "Verkäufer hat nicht geliefert.", banFaultUser: true },
    });
    expect(resolved.status).toBe(200);

    const trade = (await api.call("GET", `/api/trades/${tradeId}`, { cookie: buyer.cookie })).body.trade;
    expect(trade).toMatchObject({ status: "cancelled", cancelReason: "admin" });
    expect((await api.call("GET", "/api/me", { cookie: seller.cookie })).body.user).toBeNull();
    expect((await api.call("GET", "/api/offers?side=sell")).body.offers).toHaveLength(0);
    expect((await api.call("GET", `/api/users/${seller.user.id}`)).status).toBe(404);
  });
});
