import type { z } from "zod";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, code = "bad_request") => new HttpError(400, code, message);
export const unauthorized = (message = "Bitte zuerst mit der Wallet anmelden.") => new HttpError(401, "unauthorized", message);
export const forbidden = (message = "Dafür fehlen die Rechte.") => new HttpError(403, "forbidden", message);
export const notFound = (message = "Nicht gefunden.") => new HttpError(404, "not_found", message);
export const conflict = (message: string, code = "conflict") => new HttpError(409, code, message);

export function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  if (!headers.has("cache-control")) headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { ...init, headers });
}

export function errorResponse(error: HttpError): Response {
  return json({ error: error.message, code: error.code }, { status: error.status });
}

export async function readJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    throw badRequest("Erwarte JSON.", "unsupported_media_type");
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw badRequest("Ungültiges JSON.");
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw badRequest(issue?.message ?? "Ungültige Eingabe.", "validation_error");
  }
  return result.data;
}

/**
 * Schreibende Anfragen nur vom eigenen Origin (zusätzlich zu SameSite-Cookies).
 */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  if (origin) {
    // Hosts vergleichen statt ganzer Origins: hinter dem CDN kann das Schema der internen URL abweichen.
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    const ownHosts = [new URL(request.url).host, request.headers.get("host"), request.headers.get("x-forwarded-host")];
    if (!originHost || !ownHosts.includes(originHost)) throw forbidden("Anfrage von fremder Herkunft abgelehnt.");
    return;
  }
  if (site && site !== "same-origin" && site !== "none") {
    throw forbidden("Anfrage von fremder Herkunft abgelehnt.");
  }
}
