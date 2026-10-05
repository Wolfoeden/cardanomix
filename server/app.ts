import { z } from "zod";
import { FIATS, OFFER_SIDES, PAYMENT_METHODS } from "../shared/constants";
import { parseFiatToCents } from "../shared/money";
import type {
  ConfigResponse,
  MarketStats,
  UserProfileResponse,
} from "../shared/types";
import { createChallenge, login, loginSchema, viewerFromRequest } from "./auth";
import { networkId } from "./config";
import {
  depositSubmitSchema,
  depositTxSchema,
  payoutSubmitSchema,
  payoutTxSchema,
  prepareDeposit,
  preparePayout,
  submitDeposit,
  submitPayout,
} from "./escrow/service";
import { isUniqueViolation, toIso, UUID_RE, type AppContext } from "./context";
import {
  assertSameOrigin,
  badRequest,
  conflict,
  errorResponse,
  HttpError,
  json,
  notFound,
  readJson,
  unauthorized,
} from "./http";
import {
  createOffer,
  createOfferSchema,
  getOffer,
  listMarket,
  listUserOffers,
  offerStatusSchema,
  setOfferStatus,
} from "./offers";
import {
  clearedSessionCookie,
  createSessionToken,
  sessionCookie,
} from "./session";
import {
  cancelTrade,
  confirmReceipt,
  disputeSchema,
  disputeTrade,
  getTradeDetail,
  listDisputes,
  listMyTrades,
  markPaid,
  messageSchema,
  postMessage,
  rateSchema,
  rateTrade,
  releaseSchema,
  releaseTrade,
  resolveDispute,
  resolveSchema,
  startTrade,
  startTradeSchema,
} from "./trades";
import {
  DISPLAY_NAME_RE,
  findUser,
  loadStats,
  toMe,
  toPublicUser,
  type UserRow,
} from "./users";
import {
  getListing,
  saveListing,
  listListings,
  listingFilterSchema,
  listingSchema,
  listingStatusSchema,
  setListingStatus,
  duplicateListing,
} from "./marketplace/listings";
import {
  startUpload,
  finishUpload,
  deleteImage,
  uploadSchema,
} from "./marketplace/storage";
import {
  createOrder,
  getOrder,
  myOrders,
  orderInput,
  orderActionInput,
  orderAction,
  expireUnpaid,
} from "./marketplace/orders";
import {
  preparePayment,
  submitPayment,
  paymentInput,
  paymentSubmitInput,
  checkOrder,
  syncPayment,
} from "./marketplace/payments";
import {
  conversations,
  startConversation,
  getMessages,
  sendMessage,
  messageInput,
} from "./marketplace/chat";
import {
  reportListing,
  reports,
  moderateReport,
  moderationInput,
  reportInput,
  disputedOrders,
  resolveOrder,
} from "./marketplace/moderation";

type Params = Record<string, string>;

interface RouteArgs {
  request: Request;
  url: URL;
  params: Params;
  ctx: AppContext;
  viewer: () => Promise<UserRow | null>;
  requireViewer: () => Promise<UserRow>;
}

type Handler = (args: RouteArgs) => Promise<Response>;

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
}

const routes: Route[] = [];

function route(method: string, path: string, handler: Handler) {
  routes.push({ method, segments: path.split("/").filter(Boolean), handler });
}

function matchPath(route: Route, segments: string[]): Params | null {
  if (route.segments.length !== segments.length) return null;
  const params: Params = {};
  for (let i = 0; i < segments.length; i++) {
    const expected = route.segments[i];
    if (expected.startsWith(":")) {
      try {
        params[expected.slice(1)] = decodeURIComponent(segments[i]);
      } catch {
        return null;
      }
    } else if (expected !== segments[i]) {
      return null;
    }
  }
  return params;
}

const ok = () => json({ ok: true });

route("GET", "/api/listings", async ({ ctx, url }) => {
  const filter = listingFilterSchema.safeParse(
    Object.fromEntries([...url.searchParams].filter(([, v]) => v !== "")),
  );
  if (!filter.success) throw badRequest("Ungültiger Filter.");
  await expireUnpaid(ctx);
  return json({ listings: await listListings(ctx, filter.data) });
});
route("GET", "/api/me/listings", async ({ ctx, requireViewer }) =>
  json({
    listings: await listListings(
      ctx,
      listingFilterSchema.parse({}),
      await requireViewer(),
    ),
  }),
);
route("GET", "/api/listings/:listingId", async ({ ctx, params, viewer }) =>
  json({ listing: await getListing(ctx, params.listingId, await viewer()) }),
);
route("POST", "/api/listings", async ({ ctx, request, requireViewer }) =>
  json(
    {
      listing: await saveListing(
        ctx,
        await requireViewer(),
        await readJson(request, listingSchema),
      ),
    },
    { status: 201 },
  ),
);
route(
  "PUT",
  "/api/listings/:listingId",
  async ({ ctx, params, request, requireViewer }) =>
    json({
      listing: await saveListing(
        ctx,
        await requireViewer(),
        await readJson(request, listingSchema),
        params.listingId,
      ),
    }),
);
route(
  "PATCH",
  "/api/listings/:listingId",
  async ({ ctx, params, request, requireViewer }) =>
    json({
      listing: await setListingStatus(
        ctx,
        await requireViewer(),
        params.listingId,
        (await readJson(request, listingStatusSchema)).status,
      ),
    }),
);
route(
  "POST",
  "/api/listings/:listingId/duplicate",
  async ({ ctx, params, requireViewer }) =>
    json(
      {
        listing: await duplicateListing(
          ctx,
          await requireViewer(),
          params.listingId,
        ),
      },
      { status: 201 },
    ),
);
route(
  "POST",
  "/api/listings/:listingId/images",
  async ({ ctx, params, request, requireViewer }) =>
    json(
      await startUpload(
        ctx,
        await requireViewer(),
        params.listingId,
        await readJson(request, uploadSchema),
      ),
      { status: 201 },
    ),
);
route(
  "POST",
  "/api/listings/:listingId/images/:imageId/complete",
  async ({ ctx, params, requireViewer }) => {
    await finishUpload(
      ctx,
      await requireViewer(),
      params.listingId,
      params.imageId,
    );
    return ok();
  },
);
route(
  "DELETE",
  "/api/listings/:listingId/images/:imageId",
  async ({ ctx, params, requireViewer }) => {
    await deleteImage(
      ctx,
      await requireViewer(),
      params.listingId,
      params.imageId,
    );
    return ok();
  },
);
route(
  "POST",
  "/api/listings/:listingId/orders",
  async ({ ctx, params, request, requireViewer }) =>
    json(
      {
        order: await createOrder(
          ctx,
          await requireViewer(),
          params.listingId,
          (await readJson(request, orderInput)).deliveryDetails,
        ),
      },
      { status: 201 },
    ),
);
route("GET", "/api/me/orders", async ({ ctx, requireViewer }) => {
  const user = await requireViewer();
  await expireUnpaid(ctx);
  return json({ orders: await myOrders(ctx, user) });
});
route("GET", "/api/orders/:orderId", async ({ ctx, params, requireViewer }) => {
  const user = await requireViewer();
  await getOrder(ctx, user, params.orderId);
  await expireUnpaid(ctx);
  await syncPayment(ctx, params.orderId);
  return json({ order: await getOrder(ctx, user, params.orderId) });
});
route(
  "POST",
  "/api/orders/:orderId/payment-tx",
  async ({ ctx, params, request, requireViewer }) =>
    json(
      await preparePayment(
        ctx,
        await requireViewer(),
        params.orderId,
        await readJson(request, paymentInput),
      ),
    ),
);
route(
  "POST",
  "/api/orders/:orderId/payment",
  async ({ ctx, params, request, requireViewer }) =>
    json(
      await submitPayment(
        ctx,
        await requireViewer(),
        params.orderId,
        await readJson(request, paymentSubmitInput),
      ),
    ),
);
route(
  "POST",
  "/api/orders/:orderId/check",
  async ({ ctx, params, requireViewer }) =>
    json({
      order: await checkOrder(ctx, await requireViewer(), params.orderId),
    }),
);
route(
  "POST",
  "/api/orders/:orderId/action",
  async ({ ctx, params, request, requireViewer }) => {
    const user = await requireViewer(),
      input = await readJson(request, orderActionInput);
    if (input.action !== "cancel") await checkOrder(ctx, user, params.orderId);
    return json({
      order: await orderAction(
        ctx,
        user,
        params.orderId,
        input.action,
        input.note,
      ),
    });
  },
);
route("GET", "/api/conversations", async ({ ctx, requireViewer }) =>
  json({ conversations: await conversations(ctx, await requireViewer()) }),
);
route(
  "POST",
  "/api/listings/:listingId/conversation",
  async ({ ctx, params, requireViewer }) =>
    json({
      conversationId: await startConversation(
        ctx,
        await requireViewer(),
        params.listingId,
      ),
    }),
);
route(
  "GET",
  "/api/conversations/:conversationId/messages",
  async ({ ctx, params, requireViewer }) =>
    json({
      messages: await getMessages(
        ctx,
        await requireViewer(),
        params.conversationId,
      ),
    }),
);
route(
  "POST",
  "/api/conversations/:conversationId/messages",
  async ({ ctx, params, request, requireViewer }) => {
    await sendMessage(
      ctx,
      await requireViewer(),
      params.conversationId,
      (await readJson(request, messageInput)).body,
    );
    return ok();
  },
);
route(
  "POST",
  "/api/listings/:listingId/report",
  async ({ ctx, params, request, requireViewer }) => {
    await reportListing(
      ctx,
      await requireViewer(),
      params.listingId,
      (await readJson(request, reportInput)).reason,
    );
    return ok();
  },
);
route("GET", "/api/admin/reports", async ({ ctx, requireViewer }) =>
  json({ reports: await reports(ctx, await requireViewer()) }),
);
route(
  "POST",
  "/api/admin/reports/:reportId",
  async ({ ctx, params, request, requireViewer }) => {
    await moderateReport(
      ctx,
      await requireViewer(),
      params.reportId,
      (await readJson(request, moderationInput)).action,
    );
    return ok();
  },
);
route("GET", "/api/admin/orders", async ({ ctx, requireViewer }) =>
  json({ orders: await disputedOrders(ctx, await requireViewer()) }),
);
route(
  "POST",
  "/api/admin/orders/:orderId/resolve",
  async ({ ctx, params, request, requireViewer }) => {
    await resolveOrder(
      ctx,
      await requireViewer(),
      params.orderId,
      (
        await readJson(
          request,
          z.object({ note: z.string().trim().min(5).max(2000) }).strict(),
        )
      ).note,
    );
    return ok();
  },
);

// --- Öffentliche Daten ---------------------------------------------------------

route("GET", "/api/config", async ({ ctx }) => {
  const body: ConfigResponse = {
    network: ctx.config.network,
    networkId: networkId(ctx.config.network),
  };
  return json(body);
});

/** Betriebsstatus ohne Geheimnisse: Ist die Datenbank erreichbar und der Login eingerichtet? */
route("GET", "/api/health", async ({ ctx }) => {
  let database = false;
  try {
      await ctx.db.query("select id from cardanomix.users limit 0");
      await ctx.db.query("select tx_hash,ttl_slot from cardanomix.order_payments limit 0");
    database = true;
  } catch {
    database = false;
  }
  const login = Boolean(ctx.config.sessionSecret);
  const escrow = Boolean(ctx.config.arbiterSecret);
  const ok = database && login && escrow;
  return json(
    { ok, database, login, escrow, network: ctx.config.network },
    { status: ok ? 200 : 503 },
  );
});

route("GET", "/api/prices", async ({ ctx }) =>
  json(await ctx.prices.get(), {
    headers: {
      "cache-control": "public, max-age=0, must-revalidate",
      "netlify-cdn-cache-control":
        "public, s-maxage=60, stale-while-revalidate=120",
    },
  }),
);

route("GET", "/api/stats", async ({ ctx }) => {
  const { rows } = await ctx.db.query<{
    offers: unknown;
    trades: unknown;
    traders: unknown;
  }>(
    `select
       (select count(*) from cardanomix.offers o join cardanomix.users u on u.id = o.user_id where o.status = 'active' and not u.is_banned) as offers,
       (select count(*) from cardanomix.trades where status = 'completed') as trades,
       (select count(*) from cardanomix.users where not is_banned) as traders`,
  );
  const body: MarketStats = {
    activeOffers: Number(rows[0]?.offers ?? 0),
    completedTrades: Number(rows[0]?.trades ?? 0),
    traders: Number(rows[0]?.traders ?? 0),
  };
  return json(body);
});

const marketQuery = z.object({
  side: z.enum(OFFER_SIDES).default("sell"),
  fiat: z.enum(FIATS).optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
  amount: z.string().max(20).optional(),
});

route("GET", "/api/offers", async ({ url, ctx }) => {
  const parsed = marketQuery.safeParse(
    Object.fromEntries(
      [...url.searchParams].filter(([, value]) => value !== ""),
    ),
  );
  if (!parsed.success) throw badRequest("Ungültiger Filter.");
  const amountCents = parsed.data.amount
    ? parseFiatToCents(parsed.data.amount)
    : null;
  if (parsed.data.amount && amountCents == null)
    throw badRequest("Ungültiger Betrag im Filter.");
  const offers = await listMarket(ctx, {
    side: parsed.data.side,
    fiat: parsed.data.fiat,
    method: parsed.data.method,
    amountCents: amountCents ?? undefined,
  });
  return json({ offers });
});

route("GET", "/api/offers/:offerId", async ({ params, ctx }) =>
  json({ offer: await getOffer(ctx, params.offerId) }),
);

route("GET", "/api/users/:userId", async ({ params, ctx }) => {
  const user = await findUser(ctx.db, params.userId);
  if (!user || user.is_banned) throw notFound("Nutzer nicht gefunden.");
  const stats = await loadStats(ctx.db, [user.id]);
  const { rows } = await ctx.db.query<{
    rater_id: string;
    rater_name: string;
    positive: boolean;
    comment: string;
    created_at: Date | string;
  }>(
    `select r.rater_id, u.display_name as rater_name, r.positive, r.comment, r.created_at
     from cardanomix.ratings r join cardanomix.users u on u.id = r.rater_id
     where r.ratee_id = $1 order by r.created_at desc limit 30`,
    [user.id],
  );
  const body: UserProfileResponse = {
    user: toPublicUser(user, stats.get(user.id)),
    offers: await listUserOffers(ctx, user.id, false),
    ratings: rows.map((row) => ({
      positive: row.positive,
      comment: row.comment,
      createdAt: toIso(row.created_at),
      rater: { id: row.rater_id, displayName: row.rater_name },
    })),
  };
  return json(body);
});

// --- Anmeldung -----------------------------------------------------------------

route("GET", "/api/auth/challenge", async ({ url, request, ctx }) => {
  const host = request.headers.get("host") ?? url.host;
  return json(await createChallenge(ctx, host));
});

route("POST", "/api/auth/login", async ({ request, ctx }) => {
  const input = await readJson(request, loginSchema);
  const user = await login(ctx, input);
  const token = createSessionToken(
    user.id,
    ctx.config.sessionSecret!,
    ctx.now().getTime(),
  );
  return json(
    { user: await toMe(ctx, user) },
    { headers: { "set-cookie": sessionCookie(token) } },
  );
});

route("POST", "/api/auth/logout", async () =>
  json({ ok: true }, { headers: { "set-cookie": clearedSessionCookie() } }),
);

route("GET", "/api/me", async ({ ctx, viewer }) => {
  const user = await viewer();
  return json({ user: user ? await toMe(ctx, user) : null });
});

const profileSchema = z
  .object({
    displayName: z
      .string()
      .trim()
      .regex(
        DISPLAY_NAME_RE,
        "Name: 3–24 Zeichen, Buchstaben, Ziffern, Leerzeichen, Punkt, Binde- oder Unterstrich.",
      ),
  })
  .strict();

route("PATCH", "/api/me", async ({ request, ctx, requireViewer }) => {
  const user = await requireViewer();
  const input = await readJson(request, profileSchema);
  try {
    await ctx.db.query(
      "update cardanomix.users set display_name = $2 where id = $1",
      [user.id, input.displayName],
    );
  } catch (error) {
    if (isUniqueViolation(error))
      throw conflict("Dieser Name ist schon vergeben.", "name_taken");
    throw error;
  }
  const updated = await findUser(ctx.db, user.id);
  return json({ user: await toMe(ctx, updated!) });
});

route("GET", "/api/me/trades", async ({ ctx, requireViewer }) =>
  json({ trades: await listMyTrades(ctx, await requireViewer()) }),
);

route("GET", "/api/me/offers", async ({ ctx, requireViewer }) => {
  const user = await requireViewer();
  return json({ offers: await listUserOffers(ctx, user.id, true) });
});

// --- Angebote ------------------------------------------------------------------

route("POST", "/api/offers", async ({ request, ctx, requireViewer }) => {
  const user = await requireViewer();
  const input = await readJson(request, createOfferSchema);
  return json({ offer: await createOffer(ctx, user, input) }, { status: 201 });
});

route(
  "PATCH",
  "/api/offers/:offerId",
  async ({ request, params, ctx, requireViewer }) => {
    const user = await requireViewer();
    const input = await readJson(request, offerStatusSchema);
    await setOfferStatus(ctx, user, params.offerId, input.status);
    return ok();
  },
);

route(
  "POST",
  "/api/offers/:offerId/trades",
  async ({ request, params, ctx, requireViewer }) => {
    const user = await requireViewer();
    const input = await readJson(request, startTradeSchema);
    const tradeId = await startTrade(ctx, user, params.offerId, input);
    return json({ tradeId }, { status: 201 });
  },
);

// --- Trades --------------------------------------------------------------------

route(
  "GET",
  "/api/trades/:tradeId",
  async ({ url, params, ctx, requireViewer }) => {
    const after = Number(url.searchParams.get("after") ?? 0);
    const detail = await getTradeDetail(
      ctx,
      await requireViewer(),
      params.tradeId,
      Number.isSafeInteger(after) && after > 0 ? after : 0,
    );
    return json(detail);
  },
);

route(
  "POST",
  "/api/trades/:tradeId/paid",
  async ({ params, ctx, requireViewer }) => {
    await markPaid(ctx, await requireViewer(), params.tradeId);
    return ok();
  },
);

route(
  "POST",
  "/api/trades/:tradeId/cancel",
  async ({ params, ctx, requireViewer }) => {
    await cancelTrade(ctx, await requireViewer(), params.tradeId);
    return ok();
  },
);

route(
  "POST",
  "/api/trades/:tradeId/confirm",
  async ({ params, ctx, requireViewer }) => {
    await confirmReceipt(ctx, await requireViewer(), params.tradeId);
    return ok();
  },
);

route(
  "POST",
  "/api/trades/:tradeId/release",
  async ({ request, params, ctx, requireViewer }) => {
    const user = await requireViewer();
    const input = await readJson(request, releaseSchema);
    return json(await releaseTrade(ctx, user, params.tradeId, input.txHash));
  },
);

// --- Treuhand ------------------------------------------------------------------

route(
  "POST",
  "/api/trades/:tradeId/escrow/check",
  async ({ params, ctx, requireViewer }) =>
    json(
      await getTradeDetail(ctx, await requireViewer(), params.tradeId, 0, true),
    ),
);

route(
  "POST",
  "/api/trades/:tradeId/escrow/deposit-tx",
  async ({ request, params, ctx, requireViewer }) => {
    const user = await requireViewer();
    const input = await readJson(request, depositTxSchema);
    return json(await prepareDeposit(ctx, user, params.tradeId, input));
  },
);

route(
  "POST",
  "/api/trades/:tradeId/escrow/deposit",
  async ({ request, params, ctx, requireViewer }) => {
    const user = await requireViewer();
    const input = await readJson(request, depositSubmitSchema);
    return json(await submitDeposit(ctx, user, params.tradeId, input));
  },
);

route(
  "POST",
  "/api/trades/:tradeId/escrow/payout-tx",
  async ({ request, params, ctx, requireViewer }) => {
    const user = await requireViewer();
    const input = await readJson(request, payoutTxSchema);
    return json(await preparePayout(ctx, user, params.tradeId, input.kind));
  },
);

route(
  "POST",
  "/api/trades/:tradeId/escrow/payout",
  async ({ request, params, ctx, requireViewer }) => {
    const user = await requireViewer();
    const input = await readJson(request, payoutSubmitSchema);
    return json(await submitPayout(ctx, user, params.tradeId, input));
  },
);

route(
  "POST",
  "/api/trades/:tradeId/dispute",
  async ({ request, params, ctx, requireViewer }) => {
    const user = await requireViewer();
    const input = await readJson(request, disputeSchema);
    await disputeTrade(ctx, user, params.tradeId, input.reason);
    return ok();
  },
);

route(
  "POST",
  "/api/trades/:tradeId/messages",
  async ({ request, params, ctx, requireViewer }) => {
    const user = await requireViewer();
    const input = await readJson(request, messageSchema);
    await postMessage(ctx, user, params.tradeId, input.body);
    return json({ ok: true }, { status: 201 });
  },
);

route(
  "POST",
  "/api/trades/:tradeId/rating",
  async ({ request, params, ctx, requireViewer }) => {
    const user = await requireViewer();
    const input = await readJson(request, rateSchema);
    await rateTrade(ctx, user, params.tradeId, input);
    return json({ ok: true }, { status: 201 });
  },
);

// --- Moderation ----------------------------------------------------------------

route("GET", "/api/admin/disputes", async ({ ctx, requireViewer }) =>
  json({ disputes: await listDisputes(ctx, await requireViewer()) }),
);

route(
  "POST",
  "/api/admin/trades/:tradeId/resolve",
  async ({ request, params, ctx, requireViewer }) => {
    const user = await requireViewer();
    const input = await readJson(request, resolveSchema);
    await resolveDispute(ctx, user, params.tradeId, input);
    return ok();
  },
);

// --- Einstieg ------------------------------------------------------------------

function isMissingDatabase(error: unknown): boolean {
  return (
    error instanceof Error && error.name === "MissingDatabaseConnectionError"
  );
}

export function createApp(ctx: AppContext) {
  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();
    const segments = url.pathname.split("/").filter(Boolean);
    try {
      let found: { route: Route; params: Params } | null = null;
      let pathMatched = false;
      for (const candidate of routes) {
        const params = matchPath(candidate, segments);
        if (!params) continue;
        pathMatched = true;
        if (candidate.method === method) {
          found = { route: candidate, params };
          break;
        }
      }
      if (!found) {
        if (pathMatched)
          return json(
            { error: "Methode nicht erlaubt.", code: "method_not_allowed" },
            { status: 405 },
          );
        throw notFound("Unbekannter API-Pfad.");
      }
      for (const [name, value] of Object.entries(found.params)) {
        if (name.endsWith("Id") && !UUID_RE.test(value)) throw notFound();
      }
      if (method !== "GET" && method !== "HEAD") assertSameOrigin(request);
      if (
        !["GET", "HEAD"].includes(method) &&
        process.env.CMX_READ_ONLY === "1"
      )
        throw new HttpError(
          503,
          "maintenance",
          "Kurze Wartung: Bitte in wenigen Minuten erneut versuchen.",
        );

      let cachedViewer: Promise<UserRow | null> | null = null;
      const viewer = () => (cachedViewer ??= viewerFromRequest(ctx, request));
      const requireViewer = async () => {
        const user = await viewer();
        if (!user) throw unauthorized();
        return user;
      };
      return await found.route.handler({
        request,
        url,
        params: found.params,
        ctx,
        viewer,
        requireViewer,
      });
    } catch (error) {
      if (error instanceof HttpError) return errorResponse(error);
      if (isMissingDatabase(error)) {
        return errorResponse(
          new HttpError(
            503,
            "database_unavailable",
            "Die Datenbank ist noch nicht verbunden.",
          ),
        );
      }
      console.error("API-Fehler", method, url.pathname, error);
      return errorResponse(
        new HttpError(
          500,
          "internal",
          "Interner Fehler. Bitte später erneut versuchen.",
        ),
      );
    }
  };
}
