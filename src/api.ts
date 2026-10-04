import type { Fiat, OfferSide, OfferStatus, PaymentMethod } from "../shared/constants";
import type {
  ConfigResponse,
  DisputeSummary,
  MarketStats,
  Me,
  Offer,
  PricesResponse,
  ReleaseResponse,
  TradeDetailResponse,
  TradeSummary,
  UserProfileResponse,
} from "../shared/types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "network", "Keine Verbindung zum Server. Bitte Internetverbindung prüfen.");
  }
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const error = data as { error?: string; code?: string } | null;
    throw new ApiError(response.status, error?.code ?? "error", error?.error ?? `Fehler ${response.status}`);
  }
  return data as T;
}

export interface CreateOfferInput {
  side: OfferSide;
  fiat: Fiat;
  priceType: "fixed" | "margin";
  fixedPrice?: string;
  marginPercent?: number;
  amountAda: string;
  minFiat: string;
  maxFiat: string;
  paymentMethods: PaymentMethod[];
  terms: string;
  paymentWindowMin: number;
}

export interface MarketQuery {
  side: OfferSide;
  fiat?: Fiat | "";
  method?: PaymentMethod | "";
  amount?: string;
}

export const api = {
  config: () => request<ConfigResponse>("GET", "/api/config"),
  prices: () => request<PricesResponse>("GET", "/api/prices"),
  stats: () => request<MarketStats>("GET", "/api/stats"),
  market: (query: MarketQuery) => {
    const params = new URLSearchParams();
    params.set("side", query.side);
    if (query.fiat) params.set("fiat", query.fiat);
    if (query.method) params.set("method", query.method);
    if (query.amount) params.set("amount", query.amount);
    return request<{ offers: Offer[] }>("GET", `/api/offers?${params}`);
  },
  offer: (id: string) => request<{ offer: Offer }>("GET", `/api/offers/${encodeURIComponent(id)}`),
  createOffer: (input: CreateOfferInput) => request<{ offer: Offer }>("POST", "/api/offers", input),
  setOfferStatus: (id: string, status: OfferStatus) => request<{ ok: true }>("PATCH", `/api/offers/${id}`, { status }),
  startTrade: (offerId: string, input: { amountType: "fiat" | "ada"; amount: string; paymentMethod: PaymentMethod }) =>
    request<{ tradeId: string }>("POST", `/api/offers/${offerId}/trades`, input),

  challenge: () => request<{ nonce: string; message: string }>("GET", "/api/auth/challenge"),
  login: (input: { nonce: string; signature: string; key: string; receiveAddress?: string }) =>
    request<{ user: Me }>("POST", "/api/auth/login", input),
  logout: () => request<{ ok: true }>("POST", "/api/auth/logout", {}),
  me: () => request<{ user: Me | null }>("GET", "/api/me"),
  updateMe: (displayName: string) => request<{ user: Me }>("PATCH", "/api/me", { displayName }),
  myTrades: () => request<{ trades: TradeSummary[] }>("GET", "/api/me/trades"),
  myOffers: () => request<{ offers: Offer[] }>("GET", "/api/me/offers"),
  user: (id: string) => request<UserProfileResponse>("GET", `/api/users/${encodeURIComponent(id)}`),

  trade: (id: string, after = 0) =>
    request<TradeDetailResponse>("GET", `/api/trades/${encodeURIComponent(id)}${after ? `?after=${after}` : ""}`),
  markPaid: (id: string) => request<{ ok: true }>("POST", `/api/trades/${id}/paid`, {}),
  cancel: (id: string) => request<{ ok: true }>("POST", `/api/trades/${id}/cancel`, {}),
  confirm: (id: string) => request<{ ok: true }>("POST", `/api/trades/${id}/confirm`, {}),
  release: (id: string, txHash: string) => request<ReleaseResponse>("POST", `/api/trades/${id}/release`, { txHash }),
  dispute: (id: string, reason: string) => request<{ ok: true }>("POST", `/api/trades/${id}/dispute`, { reason }),
  sendMessage: (id: string, body: string) => request<{ ok: true }>("POST", `/api/trades/${id}/messages`, { body }),
  rate: (id: string, positive: boolean, comment: string) =>
    request<{ ok: true }>("POST", `/api/trades/${id}/rating`, { positive, comment }),

  disputes: () => request<{ disputes: DisputeSummary[] }>("GET", "/api/admin/disputes"),
  resolve: (
    id: string,
    input: { outcome: "completed" | "cancelled"; fault: "buyer" | "seller" | "none"; note: string; banFaultUser: boolean },
  ) => request<{ ok: true }>("POST", `/api/admin/trades/${id}/resolve`, input),
};

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Unbekannter Fehler.";
}
