export const FIATS = ["EUR", "USD", "CHF", "GBP"] as const;
export type Fiat = (typeof FIATS)[number];

export const FIAT_SYMBOL: Record<Fiat, string> = {
  EUR: "€",
  USD: "$",
  CHF: "CHF",
  GBP: "£",
};

export const PAYMENT_METHODS = [
  "SEPA",
  "SEPA_INSTANT",
  "WISE",
  "REVOLUT",
  "PAYPAL",
  "BANK_TRANSFER",
  "CASH",
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  SEPA: "SEPA-Überweisung",
  SEPA_INSTANT: "SEPA-Echtzeitüberweisung",
  WISE: "Wise",
  REVOLUT: "Revolut",
  PAYPAL: "PayPal",
  BANK_TRANSFER: "Inlandsüberweisung",
  CASH: "Bargeld (persönlich)",
};

export const OFFER_SIDES = ["sell", "buy"] as const;
export type OfferSide = (typeof OFFER_SIDES)[number];

export const OFFER_STATUSES = ["active", "paused", "closed"] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

export const TRADE_STATUSES = ["awaiting_payment", "paid", "completed", "cancelled", "disputed"] as const;
export type TradeStatus = (typeof TRADE_STATUSES)[number];

export const TRADE_STATUS_LABEL: Record<TradeStatus, string> = {
  awaiting_payment: "Wartet auf Zahlung",
  paid: "Als bezahlt markiert",
  completed: "Abgeschlossen",
  cancelled: "Abgebrochen",
  disputed: "Streitfall",
};

export const LOVELACE_PER_ADA = 1_000_000;
/** Kleinster Handel: Cardano-Ausgaben brauchen ein Minimum an ADA. */
export const MIN_TRADE_LOVELACE = 2 * LOVELACE_PER_ADA;
/** Größtes Angebot, damit Beträge sicher in JavaScript-Zahlen passen. */
export const MAX_OFFER_LOVELACE = 10_000_000 * LOVELACE_PER_ADA;
/** Konten unter dieser Zahl abgeschlossener Trades gelten als neu. */
export const NEW_USER_TRADE_THRESHOLD = 3;
/** Höchstbetrag pro Handel (in Cent der Handelswährung) für neue Konten. */
export const NEW_USER_MAX_FIAT_CENTS = 300_00;
/** Gleichzeitig offene Trades pro Konto als Käufer- oder Verkäuferseite, die man selbst gestartet hat. */
export const MAX_OPEN_TRADES_PER_TAKER = 3;
/** Gnadenfrist nach Ablauf der Zahlungsfrist, bevor ein Handel automatisch abgebrochen wird. */
export const AUTO_CANCEL_GRACE_MIN = 15;
