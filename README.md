# x401-workers

x401-workers lets your Cloudflare Worker require proof of identity on its endpoints.

When a request arrives without proof, the Worker answers with an
[x401](https://x401.proof.com/spec/latest/) proof request. The user presents their credential from
their Proof Cloud Wallet, and your handler receives the verified credential.

To call those endpoints, use [x401-agent](https://github.com/proof/x401-agent) or
[x401-cli](https://github.com/proof/x401-cli).

- [Installation](#installation)
- [Quickstart](#quickstart)
- [Usage](#usage)
  - [Add x401 to your Worker](#add-x401-to-your-worker)
  - [Use Hono](#use-hono)
  - [Read the user's claims](#read-the-users-claims)
  - [Request signature for approval](#request-signature-for-approval)
  - [Use x402](#use-x402)
- [Options](#options)
- [Responses](#responses)
- [Links](#links)
- [License](#license)

## Installation

```sh
npm install @proof.com/x401-workers @proof.com/proof-vc-server
```

Enable `nodejs_compat` in your Wrangler configuration:

```jsonc
{
  "compatibility_flags": ["nodejs_compat"],
}
```

## Quickstart

Create a Worker from the template, deploy it to `workers.dev` and enroll it as a sandbox Verifier:

```sh
npm create cloudflare@latest -- my-verifier --template=proof/x401-workers/template
cd my-verifier
npm run setup
```

Proof emails an activation link to the address you enter during setup. After you activate the
Verifier, request the endpoint that setup printed with x401-cli:

```sh
x401-cli login --sandbox
x401-cli fetch "https://my-verifier-sandbox.<your-subdomain>.workers.dev/protected"
```

The user presents their credential, and the Worker answers with the verified claims:

```json
{
  "proof_id_default": [
    {
      "credentialType": "ProofCredentialV1",
      "format": "dc+sd-jwt",
      "nonce": "afc8ffc9-e6cc-4a1d-9cd7-0c0635f264df",
      "givenName": "Alexander J",
      "familyName": "Sample",
      "isOver18": true
    }
  ]
}
```

## Usage

### Add x401 to your Worker

Your Verifier's ID is the URL where your Worker serves its public key. Generate an ES256 signing
key and store it as the `SIGNING_JWK` Worker secret:

```sh
node -e 'const k = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" }); console.log(JSON.stringify(k.privateKey.export({ format: "jwk" })))' > signing-key.json
wrangler secret put SIGNING_JWK < signing-key.json
```

Add the nonce table to your D1 migrations:

```sql
CREATE TABLE x401_nonces (
  nonce TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);

CREATE INDEX x401_nonces_expires_at ON x401_nonces (expires_at);
```

Serve the client metadata document and wrap the endpoint with `withX401`:

```ts
import {
  agentsTrustListUrl,
  clientMetadataDocument,
  d1NonceStore,
  withX401,
  type X401Options,
} from "@proof.com/x401-workers";

type Env = { DB: D1Database; SIGNING_JWK: string };

const options = (env: Env): X401Options => ({
  clientId: "https://example.com/.well-known/proof-client.json",
  privateKeyFactory: () => JSON.parse(env.SIGNING_JWK),
  nonceStore: d1NonceStore(env.DB),
  scope: "urn:proof:params:scope:verifiable-credentials:basic",
  environment: "sandbox",
  expectedOrigins: [agentsTrustListUrl("sandbox")],
});

export default {
  async fetch(request: Request, env: Env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/.well-known/proof-client.json") {
      return clientMetadataDocument({ ...options(env), clientName: "My API" });
    }
    if (pathname === "/protected") {
      return withX401(
        async (_request, presentation) =>
          Response.json(presentation.proof_id_default?.[0]?.toJSON()),
        () => options(env),
      )(request);
    }
    return new Response("Not found", { status: 404 });
  },
};
```

Deploy the Worker, and enroll it on Proof with the email that receives the activation link. Use
`"production"` instead of `"sandbox"` when going live.

```sh
npx @proof.com/proof-vc-server enroll https://example.com/.well-known/proof-client.json --email admin@example.com --key signing-key.json --environment sandbox
```

### Use Hono

`x401` sets the verified credentials as `c.var.x401`. `Env` and `options` are the ones above.

```ts
import { Hono } from "hono";
import { clientMetadataDocument } from "@proof.com/x401-workers";
import { x401, type X401Variables } from "@proof.com/x401-workers/hono";

const app = new Hono<{ Bindings: Env; Variables: X401Variables }>();

app.get("/.well-known/proof-client.json", (c) =>
  clientMetadataDocument({ ...options(c.env), clientName: "My API" }),
);
app.use(
  "/protected/*",
  x401<{ Bindings: Env }>((c) => options(c.env)),
);
app.get("/protected", (c) =>
  c.json(c.var.x401.proof_id_default?.[0]?.toJSON()),
);

export default app;
```

### Read the user's claims

The handler receives the verified credentials keyed by credential id. The `basic` scope returns
`proof_id_default`. `Env` and `options` are the ones above.

```ts
import { ProofCredentialV1 } from "@proof.com/proof-vc-server";

withX401(
  async (_request, presentation) => {
    const credential = presentation.proof_id_default?.[0];
    if (!(credential instanceof ProofCredentialV1)) {
      return new Response("Unexpected credential", { status: 400 });
    }
    return Response.json({
      name: `${credential.givenName} ${credential.familyName}`,
      isOver18: credential.isOver18,
    });
  },
  () => options(env),
);
```

### Request signature for approval

You can request a signature from a user along with their presented credential. Request a signature
if you require the user to approve a payment mandate, a wire instruction, or anything your business
needs human approval on. Pass it as `transactionData`. `Env` and `options` are the ones above.

```ts
import { TX_DATA_TYPE, transactionData } from "@proof.com/proof-vc-server";

withX401(
  async (_request, presentation) => {
    const order = presentation.proof_id_default?.[0]?.getTransactionData(
      TX_DATA_TYPE.PAYMENT_ITEMIZED,
    );
    return Response.json(order);
  },
  () => ({
    ...options(env),
    transactionData: transactionData.paymentItemized({
      currency: "USD",
      items: [{ quantity: 1, unit_cost: 12.5, label: "Book" }],
    }),
  }),
);
```

### Use x402

You can choose to pay for x401 presentations with x402. Pass an x402-paying `fetch`, which
replaces the `fetch` used to call Proof. `X402_PRIVATE_KEY` is a Worker secret holding the payer's `0x…` key, and `Env` and
`options` are the ones above. [Learn how to pay for verifications with x402](https://dev.proof.com/docs/x401-signatures).

```ts
import { x402Client } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { privateKeyToAccount } from "viem/accounts";

const payments = new x402Client().register(
  "eip155:*",
  new ExactEvmScheme(privateKeyToAccount(env.X402_PRIVATE_KEY)),
);

withX401(
  async () => new Response("OK"),
  () => ({
    ...options(env),
    fetch: wrapFetchWithPayment(fetch, payments),
  }),
);
```

## Options

| Option              | Required | Description                                                                                                     |
| ------------------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| `clientId`          | yes      | The URL of your client metadata document                                                                        |
| `privateKeyFactory` | yes      | Returns the ES256 private JWK whose public key the document publishes                                           |
| `nonceStore`        | yes      | `d1NonceStore(db)` or `kvNonceStore(kv)`                                                                        |
| `scope`             | yes      | The credential scope; see [Scopes and claims](https://dev.proof.com/docs/verify-a-credential#scopes-and-claims) |
| `expectedOrigins`   | yes      | `[agentsTrustListUrl(environment)]`                                                                             |
| `environment`       | no       | `"production"` (default) or `"sandbox"`                                                                         |
| `transactionData`   | no       | Transaction data the user approves with their credential                                                        |
| `fetch`             | no       | Replaces the `fetch` used to call Proof                                                                         |

## Responses

| Name                                       | Description                                 |
| ------------------------------------------ | ------------------------------------------- |
| No `PROOF-RESPONSE`                        | `401` with `PROOF-REQUEST`                  |
| Malformed, expired or unfetchable response | `400` with `PROOF-RESULT: invalid_response` |
| Presentation rejected by Proof             | `401` with `PROOF-RESULT: invalid_result`   |
| Nonce unknown, expired or reused           | `401` with `PROOF-RESULT: invalid_nonce`    |

## Links

- [Read the x401 specification](https://x401.proof.com/spec/latest/)
- [Call x401 endpoints in code with x401-agent](https://github.com/proof/x401-agent)
- [Call x401 endpoints from a terminal with x401-cli](https://github.com/proof/x401-cli)

## License

[Apache-2.0](LICENSE)
