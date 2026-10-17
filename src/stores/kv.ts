import type { KVNamespace } from "@cloudflare/workers-types";
import type { NonceStore } from "../types.ts";

const DEFAULT_TTL_SECONDS = 600;

export function kvNonceStore(
  kv: KVNamespace,
  options: { ttlSeconds?: number; prefix?: string } = {},
): NonceStore {
  const ttl = options.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const key = (nonce: string) => `${options.prefix ?? "x401:nonce:"}${nonce}`;
  return {
    async mint() {
      const nonce = crypto.randomUUID();
      await kv.put(key(nonce), "1", { expirationTtl: ttl });
      return nonce;
    },
    async verify(nonce) {
      const found = (await kv.get(key(nonce))) !== null;
      if (found) {
        await kv.delete(key(nonce));
      }
      return found;
    },
  };
}
