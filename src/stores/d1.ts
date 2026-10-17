import type { D1Database } from "@cloudflare/workers-types";
import type { NonceStore } from "../types.ts";

const DEFAULT_TTL_SECONDS = 600;

const now = () => Math.floor(Date.now() / 1000);

export function d1NonceStore(
  db: D1Database,
  options: { ttlSeconds?: number } = {},
): NonceStore {
  const ttl = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  return {
    async mint() {
      const nonce = crypto.randomUUID();
      await db.batch([
        db.prepare("DELETE FROM x401_nonces WHERE expires_at < ?").bind(now()),
        db
          .prepare("INSERT INTO x401_nonces (nonce, expires_at) VALUES (?, ?)")
          .bind(nonce, now() + ttl),
      ]);
      return nonce;
    },
    async verify(nonce) {
      const result = await db
        .prepare("DELETE FROM x401_nonces WHERE nonce = ? AND expires_at >= ?")
        .bind(nonce, now())
        .run();
      return result.meta.changes === 1;
    },
  };
}
