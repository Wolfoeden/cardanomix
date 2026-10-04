import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { ConfigResponse, PricesResponse } from "../shared/types";

export interface LoadState<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  reload: () => Promise<void>;
}

/** Lädt Daten beim Mount und wenn sich `deps` ändern; ältere Antworten werden verworfen. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]): LoadState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const counter = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  const reload = useCallback(async () => {
    const id = ++counter.current;
    setLoading(true);
    try {
      const result = await loadRef.current();
      if (id === counter.current) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (id === counter.current) setError(err);
    } finally {
      if (id === counter.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, deps);

  return { data, error, loading, reload };
}

export function useInterval(callback: () => void, ms: number | null): void {
  const saved = useRef(callback);
  saved.current = callback;
  useEffect(() => {
    if (ms == null) return;
    const id = window.setInterval(() => saved.current(), ms);
    return () => window.clearInterval(id);
  }, [ms]);
}

/** Aktuelle Uhrzeit, die sich im angegebenen Takt aktualisiert (für Countdowns). */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useInterval(() => setNow(Date.now()), ms);
  return now;
}

let pricesCache: { at: number; value: PricesResponse } | null = null;
const priceListeners = new Set<(value: PricesResponse) => void>();
let pricesTimer: number | null = null;

async function refreshPrices() {
  try {
    const value = await api.prices();
    pricesCache = { at: Date.now(), value };
    priceListeners.forEach((listener) => listener(value));
  } catch {
    // Kurse sind optional – Anzeige bleibt beim letzten Stand
  }
}

/** Gemeinsamer Kurs-Abruf für alle Komponenten, aktualisiert jede Minute. */
export function usePrices(): PricesResponse | null {
  const [prices, setPrices] = useState<PricesResponse | null>(pricesCache?.value ?? null);
  useEffect(() => {
    priceListeners.add(setPrices);
    if (!pricesCache || Date.now() - pricesCache.at > 60_000) void refreshPrices();
    if (pricesTimer == null) pricesTimer = window.setInterval(refreshPrices, 60_000);
    return () => {
      priceListeners.delete(setPrices);
      if (priceListeners.size === 0 && pricesTimer != null) {
        window.clearInterval(pricesTimer);
        pricesTimer = null;
      }
    };
  }, []);
  return prices;
}

let configPromise: Promise<ConfigResponse> | null = null;

export function useConfig(): ConfigResponse | null {
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  useEffect(() => {
    configPromise ??= api.config().catch((error) => {
      configPromise = null;
      throw error;
    });
    configPromise.then(setConfig, () => undefined);
  }, []);
  return config;
}

export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title ? `${title} · CardanoMix P2P` : "CardanoMix P2P – ADA Peer-to-Peer handeln";
  }, [title]);
}
