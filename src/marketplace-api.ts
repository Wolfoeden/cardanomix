import type {
  Conversation,
  Listing,
  ListingInput,
  Message,
  Order,
  PaymentPreview,
  Report,
} from "../shared/marketplace";
import { request } from "./api";
const id = (value: string) => encodeURIComponent(value);
export const marketApi = {
  listings: (params: URLSearchParams) =>
    request<{ listings: Listing[] }>("GET", `/api/listings?${params}`),
  listing: (key: string) =>
    request<{ listing: Listing }>("GET", `/api/listings/${id(key)}`),
  save: (input: ListingInput, key?: string) =>
    request<{ listing: Listing }>(
      key ? "PUT" : "POST",
      key ? `/api/listings/${id(key)}` : "/api/listings",
      input,
    ),
  status: (key: string, status: string) =>
    request<{ listing: Listing }>("PATCH", `/api/listings/${id(key)}`, {
      status,
    }),
  duplicate: (key: string) =>
    request<{ listing: Listing }>(
      "POST",
      `/api/listings/${id(key)}/duplicate`,
      {},
    ),
  myListings: () => request<{ listings: Listing[] }>("GET", "/api/me/listings"),
  upload: (key: string, file: File) =>
    request<{ imageId: string; uploadUrl: string }>(
      "POST",
      `/api/listings/${id(key)}/images`,
      { contentType: file.type, size: file.size },
    ),
  imageReady: (key: string, imageId: string) =>
    request(
      "POST",
      `/api/listings/${id(key)}/images/${id(imageId)}/complete`,
      {},
    ),
  deleteImage: (key: string, imageId: string) =>
    request("DELETE", `/api/listings/${id(key)}/images/${id(imageId)}`),
  order: (key: string) =>
    request<{ order: Order }>("GET", `/api/orders/${id(key)}`),
  buy: (key: string, deliveryDetails: string) =>
    request<{ order: Order }>("POST", `/api/listings/${id(key)}/orders`, {
      deliveryDetails,
    }),
  myOrders: () => request<{ orders: Order[] }>("GET", "/api/me/orders"),
  paymentTx: (key: string, utxos: string[], changeAddress: string) =>
    request<PaymentPreview>("POST", `/api/orders/${id(key)}/payment-tx`, {
      utxos,
      changeAddress,
    }),
  pay: (key: string, txHash: string, witnessSet: string) =>
    request<{ txHash: string }>("POST", `/api/orders/${id(key)}/payment`, {
      txHash,
      witnessSet,
    }),
  check: (key: string) =>
    request<{ order: Order }>("POST", `/api/orders/${id(key)}/check`, {}),
  action: (key: string, action: string, note = "") =>
    request<{ order: Order }>("POST", `/api/orders/${id(key)}/action`, {
      action,
      note,
    }),
  conversations: () =>
    request<{ conversations: Conversation[] }>("GET", "/api/conversations"),
  contact: (key: string) =>
    request<{ conversationId: string }>(
      "POST",
      `/api/listings/${id(key)}/conversation`,
      {},
    ),
  messages: (key: string) =>
    request<{ messages: Message[] }>(
      "GET",
      `/api/conversations/${id(key)}/messages`,
    ),
  send: (key: string, body: string) =>
    request("POST", `/api/conversations/${id(key)}/messages`, { body }),
  report: (key: string, reason: string) =>
    request("POST", `/api/listings/${id(key)}/report`, { reason }),
  reports: () => request<{ reports: Report[] }>("GET", "/api/admin/reports"),
  moderate: (key: string, action: string) =>
    request("POST", `/api/admin/reports/${id(key)}`, { action }),
  disputedOrders: () =>
    request<{
      orders: { id: string; title: string; dispute_reason: string }[];
    }>("GET", "/api/admin/orders"),
  resolveOrder: (key: string, note: string) =>
    request("POST", `/api/admin/orders/${id(key)}/resolve`, { note }),
};
