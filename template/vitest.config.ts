import path from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc", environment: "sandbox" },
        miniflare: {
          bindings: {
            SIGNING_JWK: JSON.stringify(privateKey.export({ format: "jwk" })),
            X401_CLIENT_ID:
              "https://verifier.example/.well-known/proof-client.json",
            TEST_MIGRATIONS: await readD1Migrations(
              path.join(import.meta.dirname, "migrations"),
            ),
          },
        },
      }),
    ],
    test: {
      setupFiles: ["./test/apply-migrations.ts"],
    },
  };
});
