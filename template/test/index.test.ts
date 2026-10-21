import { env, exports } from "cloudflare:workers";
import { agentsTrustListUrl } from "@proof.com/x401-workers";
import { describe, expect, it } from "vitest";

const BASE = "https://verifier.example";

const countNonces = async () =>
  (
    await env.DB.prepare("SELECT COUNT(*) AS count FROM x401_nonces").first<{
      count: number;
    }>()
  )?.count;

describe("x401 verifier template", () => {
  it("serves the CIMD with only the public key", async () => {
    const response = await exports.default.fetch(
      `${BASE}/.well-known/proof-client.json`,
    );
    expect(response.status).toBe(200);
    const document = await response.json<{
      client_id: string;
      redirect_uris: string[];
      jwks: { keys: Record<string, unknown>[] };
    }>();
    expect(document.client_id).toBe(`${BASE}/.well-known/proof-client.json`);
    expect(document.redirect_uris).toEqual([agentsTrustListUrl("sandbox")]);
    expect(document.jwks.keys).toHaveLength(1);
    expect(document.jwks.keys[0]).not.toHaveProperty("d");
  });

  it("challenges a request without PROOF-RESPONSE and stores one nonce", async () => {
    const before = await countNonces();
    const response = await exports.default.fetch(`${BASE}/protected`);
    expect(response.status).toBe(401);
    expect(response.headers.get("PROOF-REQUEST")).toBeTruthy();
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await countNonces()).toBe((before ?? 0) + 1);
  });

  it("rejects a malformed PROOF-RESPONSE without minting a nonce", async () => {
    const before = await countNonces();
    const response = await exports.default.fetch(`${BASE}/protected`, {
      headers: { "PROOF-RESPONSE": "not-base64url-json" },
    });
    expect(response.status).toBe(400);
    expect(response.headers.get("PROOF-RESULT")).toBeTruthy();
    expect(await countNonces()).toBe(before);
  });

  it("lists missing settings on the landing page and fails closed elsewhere", async () => {
    const worker = (await import("../src/index.ts")).default;
    const unconfigured = { ...env, X401_CLIENT_ID: "" };

    const landing = await worker.fetch(new Request(`${BASE}/`), unconfigured);
    expect(landing.status).toBe(200);
    expect(await landing.text()).toContain("X401_CLIENT_ID is not set");

    const challenge = await worker.fetch(
      new Request(`${BASE}/protected`),
      unconfigured,
    );
    expect(challenge.status).toBe(500);
    expect(await challenge.text()).toContain("X401_CLIENT_ID is not set");
  });

  it("answers 404 elsewhere", async () => {
    const response = await exports.default.fetch(`${BASE}/elsewhere`);
    expect(response.status).toBe(404);
  });
});
