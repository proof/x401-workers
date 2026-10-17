import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { agent, HEADER } from "@proof.com/x401-node";
import type { ProofCredential, VPToken } from "@proof.com/proof-vc-server";
import type { NonceStore, X401Options } from "../src/types.ts";

const server = await import("@proof.com/proof-vc-server");

const presentation = (partial: Partial<VPToken>): VPToken => ({
  proof_id_default: [],
  proof_id_nationality_us: [],
  ...partial,
});

let nextPresentation: VPToken = presentation({});

mock.module("@proof.com/proof-vc-server", {
  namedExports: {
    ...server,
    createVerifier: () => ({
      verify: async () => {
        throw new Error("not used");
      },
      verifyVPToken: async () => nextPresentation,
    }),
  },
});

const { withX401 } = await import("../src/index.ts");

const credential = (nonce: string | undefined): ProofCredential =>
  ({ getNonce: () => nonce }) as unknown as ProofCredential;

function memoryStore(): NonceStore & { live: Set<string> } {
  const live = new Set<string>();
  return {
    live,
    async mint() {
      const nonce = crypto.randomUUID();
      live.add(nonce);
      return nonce;
    },
    async verify(nonce) {
      return live.delete(nonce);
    },
  };
}

const options = (nonceStore: NonceStore): X401Options => ({
  environment: "sandbox",
  clientId: "https://verifier.example/.well-known/proof-client.json",
  privateKeyFactory: () => ({ kty: "EC" }),
  nonceStore,
  scope: "urn:proof:params:scope:verifiable-credentials:basic",
  expectedOrigins: [
    "https://api.fairfax.proof.com/.well-known/agents-trust-list",
  ],
});

const presentationRequest = (): Request =>
  new Request("https://verifier.example/p", {
    headers: {
      [HEADER.PROOF_RESPONSE]: agent.encodeResultArtifact(
        agent.buildResultArtifact({
          credentialResult: {
            protocol: "openid4vp-v1-signed",
            data: { vp_token: "e30" },
          },
        }),
      ),
    },
  });

const resultCode = (response: Response): string =>
  agent.decodeErrorObject(response.headers.get(HEADER.PROOF_RESULT)!).error;

test("a verified presentation is handed whole to the handler and its nonce consumed once", async () => {
  const store = memoryStore();
  const nonce = await store.mint();
  nextPresentation = presentation({
    proof_id_default: [credential(nonce)],
    proof_id_nationality_us: [credential(nonce)],
  });
  let received: VPToken | undefined;
  const handler = withX401(
    async (_request, presentation) => {
      received = presentation;
      return new Response("granted");
    },
    () => options(store),
  );

  const response = await handler(presentationRequest());

  assert.equal(response.status, 200);
  assert.equal(received, nextPresentation);
  assert.equal(store.live.has(nonce), false);
});

test("a reused nonce is rejected with invalid_nonce", async () => {
  const store = memoryStore();
  const nonce = await store.mint();
  nextPresentation = presentation({ proof_id_default: [credential(nonce)] });
  const handler = withX401(
    async () => new Response("granted"),
    () => options(store),
  );

  assert.equal((await handler(presentationRequest())).status, 200);
  const replay = await handler(presentationRequest());

  assert.equal(replay.status, 401);
  assert.equal(resultCode(replay), "invalid_nonce");
});

test("credentials with different or missing nonces are rejected with invalid_nonce", async () => {
  const store = memoryStore();
  const nonce = await store.mint();
  const handler = withX401(
    async () => new Response("granted"),
    () => options(store),
  );

  nextPresentation = presentation({
    proof_id_default: [credential(nonce), credential("other")],
  });
  assert.equal(
    resultCode(await handler(presentationRequest())),
    "invalid_nonce",
  );

  nextPresentation = presentation({
    proof_id_default: [credential(undefined)],
  });
  assert.equal(
    resultCode(await handler(presentationRequest())),
    "invalid_nonce",
  );
  assert.equal(store.live.has(nonce), true);
});

test("a presentation whose credential carries a nonce under a non-default id is accepted", async () => {
  const store = memoryStore();
  const nonce = await store.mint();
  nextPresentation = presentation({
    proof_id_nationality_us: [credential(nonce)],
  });
  const handler = withX401(
    async () => new Response("granted"),
    () => options(store),
  );

  assert.equal((await handler(presentationRequest())).status, 200);
});
