import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test, { mock } from "node:test";
import { agent, HEADER } from "@proof.com/x401-node";
import type {
  ProofCredential,
  TransactionData,
  VPToken,
} from "@proof.com/proof-vc-server";
import type { NonceStore, X401Options } from "../src/types.ts";

const server = await import("@proof.com/proof-vc-server");
const { DefaultProofCredential, encodeTransactionData, transactionData } =
  server;

let nextPresentation: VPToken = { proof_id_default: [] };

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

const ORDER = transactionData.paymentItemized({
  currency: "USD",
  items: [{ quantity: 1, unit_cost: 12.5, label: "Book" }],
});

const OTHER_ORDER = transactionData.paymentItemized({
  currency: "USD",
  items: [{ quantity: 2, unit_cost: 12.5, label: "Book" }],
});

const hashOf = (data: TransactionData): string =>
  createHash("sha256").update(encodeTransactionData(data)).digest("base64url");

const credentialWith = (kbPayload: Record<string, unknown>): ProofCredential =>
  new DefaultProofCredential({
    claims: {},
    sdjwt: { kbJwt: { payload: kbPayload } },
  } as unknown as ConstructorParameters<typeof DefaultProofCredential>[0]);

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

async function answerWith(
  kbPayload: (nonce: string) => Record<string, unknown>,
  sent?: TransactionData,
): Promise<Response> {
  const store = memoryStore();
  const nonce = await store.mint();
  nextPresentation = {
    proof_id_default: [credentialWith({ nonce, ...kbPayload(nonce) })],
  };
  const handler = withX401(
    async () => new Response("granted"),
    () => ({
      ...options(store),
      ...(sent !== undefined && { transactionData: sent }),
    }),
  );
  return handler(presentationRequest());
}

test("a presentation bound to the transaction data sent reaches the handler", async () => {
  const response = await answerWith(
    () => ({ transaction_data_hashes: [hashOf(ORDER)] }),
    ORDER,
  );

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "granted");
});

test("a presentation bound to other terms is rejected with invalid_result", async () => {
  const response = await answerWith(
    () => ({ transaction_data_hashes: [hashOf(OTHER_ORDER)] }),
    ORDER,
  );

  assert.equal(response.status, 401);
  assert.equal(resultCode(response), "invalid_result");
});

test("a presentation bound to no transaction data is rejected with invalid_result", async () => {
  const response = await answerWith(() => ({}), ORDER);

  assert.equal(response.status, 401);
  assert.equal(resultCode(response), "invalid_result");
});

test("a presentation bound to no transaction data is granted when none was sent", async () => {
  const response = await answerWith(() => ({}));

  assert.equal(response.status, 200);
  assert.equal(await response.text(), "granted");
});

test("a presentation the verify leg has nothing to check is rejected with invalid_result", async () => {
  const store = memoryStore();
  const nonce = await store.mint();
  nextPresentation = {
    proof_id_default: [
      credentialWith({ nonce, transaction_data_hashes: [hashOf(ORDER)] }),
    ],
  };
  const handler = withX401(
    async () => new Response("granted"),
    (request) => ({
      ...options(store),
      ...(request.headers.get(HEADER.PROOF_RESPONSE) === null && {
        transactionData: ORDER,
      }),
    }),
  );

  const response = await handler(presentationRequest());

  assert.equal(response.status, 401);
  assert.equal(resultCode(response), "invalid_result");
});
