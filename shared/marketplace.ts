export const LISTING_TYPES = ["goods", "digital", "service"] as const;
export const CATEGORIES = [
  "electronics",
  "home",
  "clothing",
  "collectibles",
  "digital",
  "services",
  "other",
] as const;
export const CATEGORY_LABELS: Record<string, string> = {
  electronics: "Elektronik",
  home: "Haushalt",
  clothing: "Kleidung",
  collectibles: "Sammlerstücke",
  digital: "Digitale Produkte",
  services: "Dienstleistungen",
  other: "Sonstiges",
};
export const TYPE_LABELS: Record<string, string> = {
  goods: "Waren",
  digital: "Digitale Produkte",
  service: "Dienstleistungen",
};
export const LISTING_LABELS: Record<string, string> = {
  draft: "Entwurf",
  active: "Verfügbar",
  paused: "Pausiert",
  reserved: "Reserviert",
  sold: "Verkauft",
  archived: "Archiviert",
  hidden: "Ausgeblendet",
};
export const ORDER_LABELS: Record<string, string> = {
  awaiting_payment: "Zahlung offen",
  payment_pending: "Zahlung wird geprüft",
  paid: "Bezahlt",
  fulfilled: "Versandt / erbracht",
  completed: "Abgeschlossen",
  expired: "Abgelaufen",
  cancelled: "Abgebrochen",
  disputed: "Streitfall",
};
export const PLATFORM_FEE_LOVELACE = 1_000_000;
export const DEFAULT_FEE_ADDRESS =
  "addr1q96sjefxjumxd8ytr6ly7v00w6dl3wc3x2c5fyshkxjgfu3az3ppny73ztavycnwxrthhgsnwvyhnnw7e0pmted9qrsq9ymp9u";
export interface ListingInput {
  title: string;
  description: string;
  category: (typeof CATEGORIES)[number];
  type: (typeof LISTING_TYPES)[number];
  priceAda: string;
  shippingAda: string;
  delivery: "shipping" | "pickup" | "digital";
  condition: string;
  location: string;
  terms: string;
  serviceScope: string;
  deliveryDays: number;
}
export interface ListingImage {
  id: string;
  url: string;
  thumbnailUrl: string;
  position: number;
}
export interface Listing {
  id: string;
  sellerId: string;
  sellerName: string;
  title: string;
  description: string;
  category: string;
  type: string;
  priceLovelace: number;
  shippingLovelace: number;
  delivery: string;
  condition: string;
  location: string;
  terms: string;
  serviceScope: string;
  deliveryDays: number;
  status: string;
  images: ListingImage[];
  createdAt: string;
}
export interface Order {
  id: string;
  listingId: string;
  title: string;
  description: string;
  buyerId: string;
  sellerId: string;
  sellerName: string;
  buyerName: string;
  sellerAddress: string;
  feeAddress: string;
  priceLovelace: number;
  shippingLovelace: number;
  feeLovelace: number;
  status: string;
  deadline: string;
  txHash: string | null;
  confirmations: number;
  delivery: string;
  deliveryDetails: string;
  terms: string;
  fulfillmentNote: string;
  disputeReason: string;
  conversationId: string;
  createdAt: string;
}
export interface PaymentPreview {
  txHex: string;
  txHash: string;
  sellerAddress: string;
  sellerLovelace: number;
  feeAddress: string;
  feeLovelace: number;
  networkFeeLovelace: number;
  expiresAt: string;
}
export interface Conversation {
  id: string;
  listingId: string;
  title: string;
  buyerId: string;
  sellerId: string;
  buyerName: string;
  sellerName: string;
  updatedAt: string;
}
export interface Message {
  id: string;
  senderId: string;
  body: string;
  createdAt: string;
}
export interface Report {
  id: string;
  listingId: string;
  title: string;
  reason: string;
  status: string;
  createdAt: string;
}
