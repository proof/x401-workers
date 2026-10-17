import assert from "node:assert/strict";
import test from "node:test";
import { Hono } from "hono";
import { exportJWK, generateKeyPair } from "jose";
import { agent, HEADER } from "@proof.com/x401-node";
import { ProofVCError } from "@proof.com/proof-vc-common";
import { x401 } from "../src/hono.ts";
import {
  clientMetadataDocument,
  withX401,
  type NonceStore,
  type X401Options,
} from "../src/index.ts";

const { privateKey } = await generateKeyPair("ES256", { extractable: true });
const jwk = { ...(await exportJWK(privateKey)), alg: "ES256", kid: "test" };

const CLIENT_ID = "https://verifier.example/.well-known/proof-client.json";
const TRUST_LIST =
  "https://api.fairfax.proof.com/.well-known/agents-trust-list";
const RESULT_URI = "https://mcp.example/result";

function memoryStore(): NonceStore & { minted: string[] } {
  const live = new Set<string>();
  const minted: string[] = [];
  return {
    minted,
    async mint() {
      const nonce = crypto.randomUUID();
      live.add(nonce);
      minted.push(nonce);
      return nonce;
    },
    async verify(nonce) {
      return live.delete(nonce);
    },
  };
}

const optionsFor = (nonceStore: NonceStore): X401Options => ({
  environment: "sandbox",
  clientId: CLIENT_ID,
  privateKeyFactory: () => jwk,
  nonceStore,
  scope: "urn:proof:params:scope:verifiable-credentials:basic",
  expectedOrigins: [TRUST_LIST],
});

const decodeJwtPayload = (jwt: string): Record<string, unknown> =>
  JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString());

const base64url = (value: unknown): string =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

const requestWith = (proofResponse: string): Request =>
  new Request("https://verifier.example/p", {
    headers: { [HEADER.PROOF_RESPONSE]: proofResponse },
  });

const inlineResponse = (vpToken: unknown): string =>
  agent.encodeResultArtifact(
    agent.buildResultArtifact({
      credentialResult: {
        protocol: "openid4vp-v1-signed",
        data: { vp_token: base64url(vpToken) },
      },
    }),
  );

async function withGlobalFetch<T>(
  stub: typeof fetch,
  run: () => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = stub;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

test("a request without PROOF-RESPONSE gets a 401 challenge bound to a minted nonce", async () => {
  const store = memoryStore();
  const handler = withX401(
    async () => new Response("granted"),
    () => optionsFor(store),
  );
  const response = await handler(new Request("https://verifier.example/p"));

  assert.equal(response.status, 401);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(await response.text(), "");
  const payload = agent.decodePayload(
    response.headers.get(HEADER.PROOF_REQUEST)!,
  );
  const request = agent.getDigitalCredentialRequest(payload);
  const entry = request.requests[0]!;
  assert.equal(entry.protocol, "openid4vp-v1-signed");
  const claims = decodeJwtPayload((entry.data as { request: string }).request);
  assert.equal(claims.client_id, CLIENT_ID);
  assert.deepEqual(claims.expected_origins, [TRUST_LIST]);
  assert.equal(store.minted.length, 1);
  assert.equal(claims.nonce, store.minted[0]);
});

test("a malformed PROOF-RESPONSE gets a 400 with a fixed PROOF-RESULT description and no new challenge", async () => {
  const handler = withX401(
    async () => new Response("granted"),
    () => optionsFor(memoryStore()),
  );
  const response = await handler(requestWith("not-base64url!"));

  assert.equal(response.status, 400);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.has(HEADER.PROOF_REQUEST), false);
  const result = agent.decodeErrorObject(
    response.headers.get(HEADER.PROOF_RESULT)!,
  );
  assert.equal(result.error, "invalid_response");
  assert.equal(
    result.error_description,
    "PROOF-RESPONSE is malformed or its credential result could not be fetched",
  );
  assert.equal(await response.text(), `${result.error_description}\n`);
});

test("a credential_result_uri is dereferenced with the global fetch, not the Proof fetch", async () => {
  let fetched: string | undefined;
  let proofFetchCalled = false;
  const handler = withX401(
    async () => new Response("granted"),
    () => ({
      ...optionsFor(memoryStore()),
      fetch: async () => {
        proofFetchCalled = true;
        return new Response("{}");
      },
    }),
  );
  const artifact = agent.buildResultArtifactReference({
    credentialResultUri: RESULT_URI,
  });
  const response = await withGlobalFetch(
    async (input) => {
      fetched = String(input);
      return new Response("{}");
    },
    () => handler(requestWith(agent.encodeResultArtifact(artifact))),
  );

  assert.equal(response.status, 400);
  assert.equal(fetched, RESULT_URI);
  assert.equal(proofFetchCalled, false);
  const result = agent.decodeErrorObject(
    response.headers.get(HEADER.PROOF_RESULT)!,
  );
  assert.equal(result.error, "invalid_response");
});

test("an expired credential_result_uri is refused without fetching", async () => {
  let fetched = false;
  const handler = withX401(
    async () => new Response("granted"),
    () => optionsFor(memoryStore()),
  );
  const artifact = agent.buildResultArtifactReference({
    credentialResultUri: RESULT_URI,
    expiresAt: new Date(Date.now() - 1000).toISOString(),
  });
  const response = await withGlobalFetch(
    async () => {
      fetched = true;
      return new Response("{}");
    },
    () => handler(requestWith(agent.encodeResultArtifact(artifact))),
  );

  assert.equal(response.status, 400);
  assert.equal(fetched, false);
  const result = agent.decodeErrorObject(
    response.headers.get(HEADER.PROOF_RESULT)!,
  );
  assert.equal(result.error, "invalid_response");
});

test("a presentation without credentials is rejected with invalid_result", async () => {
  const handler = withX401(
    async () => new Response("granted"),
    () => optionsFor(memoryStore()),
  );
  const response = await handler(requestWith(inlineResponse({})));

  assert.equal(response.status, 401);
  const result = agent.decodeErrorObject(
    response.headers.get(HEADER.PROOF_RESULT)!,
  );
  assert.equal(result.error, "invalid_result");
  assert.equal(result.error_description, "The presentation was rejected");
});

test("a Proof API failure propagates as an exception instead of a PROOF-RESULT", async () => {
  const handler = withX401(
    async () => new Response("granted"),
    () => ({
      ...optionsFor(memoryStore()),
      fetch: async () => new Response("down", { status: 503 }),
    }),
  );
  const kbHeader = base64url({
    alg: "ES256",
    crit: ["proof.com#sig-1"],
    "proof.com#sig-1": "sig-1",
  });
  const detached = `a.${base64url({})}.~${kbHeader}.${base64url({})}.`;

  await assert.rejects(
    handler(requestWith(inlineResponse({ proof_id_default: [detached] }))),
    (error: unknown) =>
      error instanceof ProofVCError &&
      error.code === "authorization_server_error",
  );
});

test("the Hono middleware challenges and rejects like the core", async () => {
  const app = new Hono();
  app.use(
    "/p/*",
    x401(() => optionsFor(memoryStore())),
  );
  app.get("/p/resource", (c) => c.text("granted"));

  const challenge = await app.request("https://verifier.example/p/resource");
  assert.equal(challenge.status, 401);
  assert.equal(challenge.headers.has(HEADER.PROOF_REQUEST), true);

  const rejected = await app.request("https://verifier.example/p/resource", {
    headers: { [HEADER.PROOF_RESPONSE]: "not-base64url!" },
  });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.headers.has(HEADER.PROOF_RESULT), true);
});

test("the client metadata document publishes the public key and the expected origins", async () => {
  const response = await clientMetadataDocument({
    ...optionsFor(memoryStore()),
    clientName: "Test verifier",
  });
  const document = (await response.json()) as {
    client_id: string;
    client_name: string;
    redirect_uris: string[];
    jwks: { keys: Record<string, unknown>[] };
  };

  assert.equal(response.status, 200);
  assert.equal(document.client_id, CLIENT_ID);
  assert.equal(document.client_name, "Test verifier");
  assert.deepEqual(document.redirect_uris, [TRUST_LIST]);
  assert.equal(document.jwks.keys.length, 1);
  assert.equal("d" in document.jwks.keys[0]!, false);
  assert.equal(document.jwks.keys[0]!.x, jwk.x);
});
