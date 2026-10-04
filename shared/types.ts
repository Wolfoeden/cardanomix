import type { Fiat, OfferSide, OfferStatus, PaymentMethod, TradeStatus } from "./constants";

export type CardanoNetwork = "mainnet" | "preprod";

export interface UserStats {
  completedTrades: number;
  cancelledTrades: number;
  /** Anteil abgeschlossener an beendeten Trades (0–1), null ohne beendete Trades. */
  completionRate: number | null;
  positiveRatings: number;
  negativeRatings: number;
}

export interface PublicUser {
  id: string;
  displayName: string;
  createdAt: string;
  stats: UserStats;
}

export interface Me extends PublicUser {
  identity: string;
  receiveAddress: string;
  isAdmin: boolean;
}

export interface Offer {
  id: string;
  side: OfferSide;
  asset: "ADA";
  fiat: Fiat;
  priceType: "fixed" | "margin";
  fixedPriceMicro: number | null;
  marginBps: number | null;
  /** Wirksamer Preis pro ADA; null, wenn der Marktpreis gerade fehlt. */
  priceMicro: number | null;
  availableLovelace: number;
  minFiatCents: number;
  maxFiatCents: number;
  /** Höchstbetrag unter Berücksichtigung der verfügbaren ADA-Menge. */
  effectiveMaxFiatCents: number | null;
  paymentMethods: PaymentMethod[];
  terms: string;
  paymentWindowMin: number;
  status: OfferStatus;
  createdAt: string;
  maker: PublicUser;
}

export type TradeRole = "buyer" | "seller" | "admin";

export type TradeAction =
  | "mark_paid"
  | "cancel"
  | "release"
  | "confirm_receipt"
  | "dispute"
  | "rate"
  | "resolve";

export interface TradeParty {
  id: string;
  displayName: string;
}

export interface Rating {
  positive: boolean;
  comment: string;
  createdAt: string;
  rater: TradeParty;
}

export interface TradeMessage {
  id: number;
  senderId: string | null;
  body: string;
  createdAt: string;
}

export interface Trade {
  id: string;
  offerId: string;
  status: TradeStatus;
  fiat: Fiat;
  priceMicro: number;
  lovelace: number;
  fiatCents: number;
  paymentMethod: PaymentMethod;
  buyerAddress: string;
  paymentDeadline: string;
  txHash: string | null;
  paidAt: string | null;
  completedAt: string | null;
  completionNote: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  disputedAt: string | null;
  disputeReason: string | null;
  createdAt: string;
  buyer: TradeParty;
  seller: TradeParty;
  makerId: string;
  terms: string;
  role: TradeRole;
  actions: TradeAction[];
  ratings: Rating[];
}

export interface TradeSummary {
  id: string;
  status: TradeStatus;
  fiat: Fiat;
  lovelace: number;
  fiatCents: number;
  role: "buyer" | "seller";
  counterparty: TradeParty;
  paymentDeadline: string;
  createdAt: string;
  updatedAt: string;
}

export interface TradeDetailResponse {
  trade: Trade;
  messages: TradeMessage[];
}

export interface FiatPrice {
  priceMicro: number;
  change24h: number | null;
}

export interface PricesResponse {
  prices: Partial<Record<Fiat, FiatPrice>>;
  updatedAt: string | null;
  source: string | null;
}

export interface ConfigResponse {
  network: CardanoNetwork;
  networkId: 0 | 1;
}

export interface MarketStats {
  activeOffers: number;
  completedTrades: number;
  traders: number;
}

export interface UserProfileResponse {
  user: PublicUser;
  offers: Offer[];
  ratings: Rating[];
}

export interface ReleaseResponse {
  trade: Trade;
  verification: { ok: boolean; message: string };
}

export interface DisputeSummary {
  id: string;
  fiat: Fiat;
  lovelace: number;
  fiatCents: number;
  buyer: TradeParty;
  seller: TradeParty;
  disputeReason: string | null;
  disputedAt: string | null;
}

export interface ApiErrorBody {
  error: string;
  code: string;
}
