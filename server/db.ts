/** Minimale Datenbankschnittstelle, erfüllt von pg/Neon-Pools (Produktion) und PGlite (lokal, Tests). */
export interface Queryable {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface Db extends Queryable {
  /** Führt `fn` in einer Transaktion aus; wirft `fn`, wird zurückgerollt. */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
}

interface PoolClientLike extends Queryable {
  release(): void;
}

interface PoolLike extends Queryable {
  connect(): Promise<PoolClientLike>;
}

export function dbFromPool(pool: PoolLike): Db {
  return {
    query: (text, params) => pool.query(text, params),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const result = await fn(client);
        await client.query("commit");
        return result;
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
