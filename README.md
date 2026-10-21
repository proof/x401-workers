# @proof.com/x401-workers

[x401](https://x401.id/) middleware for Cloudflare Workers.

x401 is an open protocol that extends the HTTP `401` flow; see the
[specification](https://x401.proof.com/spec/latest/). When a user agent requests a protected
resource without identity, your Worker responds `401` with a `PROOF-REQUEST` header: a Digital
Credentials presentation request. The user agent delegates it to the user's **Wallet**, then retries
with a `PROOF-RESPONSE` header. This package builds the request, verifies the presented credential
against Proof, accepts each nonce once, and hands the verified presentation to your handler.

## Start from a template

Create, deploy and enroll a sandbox Verifier:

```sh
npm create cloudflare@latest -- my-verifier --template=proof/x401-workers/template
cd my-verifier
npm run setup
```

See [template/README.md](template/README.md).

## Installation

```sh
npm install @proof.com/x401-workers
```

The verification library uses Node built-ins, so the Worker needs the `nodejs_compat` flag and, for
`d1NonceStore`, a D1 binding:

```jsonc
{
  "compatibility_flags": ["nodejs_compat"],
  "d1_databases": [
    { "binding": "DB", "database_name": "my-api", "database_id": "…" },
  ],
}
```

## Setup

An x401 **Verifier** is an OID4VP client identified by the URL of its
[OAuth Client ID Metadata Document](https://www.ietf.org/archive/id/draft-ietf-oauth-client-id-metadata-document-02.html)
(CIMD). Three things exist before a Wallet accepts your first request.

1. **Generate a key pair.** An ES256 (`P-256`) private JWK, stored as a Worker secret:

   ```sh
   node -e 'const k = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" }); console.log(JSON.stringify(k.privateKey.export({ format: "jwk" })))' > signing-key.json
   wrangler secret put SIGNING_JWK < signing-key.json
   ```

2. **Host your CIMD.** `clientMetadataDocument()` builds it from the middleware options. Its URL is
   your `clientId`; the samples below serve it at `/.well-known/proof-client.json`.

3. **Register your CIMD.** Enroll on Proof as an x401 Verifier once the CIMD is live, then follow
   the instructions received by email. The `enroll` command requires the email to be on the CIMD's
   domain.

   ```sh
   npx @proof.com/proof-vc-server enroll https://example.com/.well-known/proof-client.json --email admin@example.com --key signing-key.json
   ```

For `d1NonceStore`, add this table to your D1 migrations:

```sql
CREATE TABLE x401_nonces (
  nonce TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);

CREATE INDEX x401_nonces_expires_at ON x401_nonces (expires_at);
```

## Protect your endpoint

`withX401` inspects the request's `PROOF-RESPONSE` header and calls your handler with the verified
presentation, keyed by credential id (`proof_id_default` for the `basic` scope).

### Plain Worker

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
  expectedOrigins: [agentsTrustListUrl("production")],
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
          Response.json(presentation.proof_id_default[0]?.toJSON()),
        () => options(env),
      )(request);
    }
    return new Response("Not found", { status: 404 });
  },
};
```

### Hono

`x401` sets the verified presentation as `c.var.x401`. `Env` and `options` are the ones above.

```ts
import { Hono } from "hono";
import { x401, type X401Variables } from "@proof.com/x401-workers/hono";
import { clientMetadataDocument } from "@proof.com/x401-workers";

const app = new Hono<{ Bindings: Env; Variables: X401Variables }>();

app.get("/.well-known/proof-client.json", (c) =>
  clientMetadataDocument({ ...options(c.env), clientName: "My API" }),
);
app.use(
  "/protected/*",
  x401<{ Bindings: Env }>((c) => options(c.env)),
);
app.get("/protected", (c) => c.json(c.var.x401.proof_id_default[0]?.toJSON()));

export default app;
```

## Options

| Option              | Type         |              | Description                                                                                                         |
| ------------------- | ------------ | ------------ | ------------------------------------------------------------------------------------------------------------------- |
| `clientId`          | String       | **Required** | The URL of your CIMD. Also the `aud` of the presentation.                                                           |
| `privateKeyFactory` | Function     | **Required** | Returns the ES256 private JWK whose public part the CIMD publishes.                                                 |
| `nonceStore`        | `NonceStore` | **Required** | `d1NonceStore(db)` or `kvNonceStore(kv)`.                                                                           |
| `scope`             | String       | **Required** | A single scope. See [Scopes and claims](https://dev.proof.com/docs/verify-a-credential#scopes-and-claims).          |
| `expectedOrigins`   | String\[]    | **Required** | Trust lists of the agents allowed to present; also the CIMD `redirect_uris`. Use `agentsTrustListUrl(environment)`. |
| `environment`       | String       | Optional     | `"production"` (default) or `"sandbox"`. Pair it with the matching trust list.                                      |
| `allowInsecureUri`  | Boolean      | Optional     | Accepts `http://` result URIs for local development. Defaults to `false`.                                           |
| `fetch`             | Function     | Optional     | Calls Proof, for example an x402-paying `fetch`. See [Pay with x402](https://dev.proof.com/docs/x401-signatures).   |

## Nonce storage

Each `PROOF-REQUEST` mints a nonce and each accepted presentation consumes it, so a presentation is
accepted once. Nonces expire after **10 minutes**; set `ttlSeconds` to change it.

- `d1NonceStore(db)` uses the `x401_nonces` table above.
- `kvNonceStore(kv)` uses a KV namespace with TTL (60 seconds minimum). KV is eventually consistent:
  a retry reaching another location within a minute may be rejected or replayed. Prefer D1 where
  strict single use matters.

## Responses

| Case                                       | Status | Headers                                    |
| ------------------------------------------ | ------ | ------------------------------------------ |
| no `PROOF-RESPONSE`                        | `401`  | `PROOF-REQUEST`, `Cache-Control: no-store` |
| malformed, expired or unfetchable response | `400`  | `PROOF-RESULT` with `invalid_response`     |
| presentation rejected by Proof             | `401`  | `PROOF-RESULT` with `invalid_result`       |
| nonce unknown, expired or reused           | `401`  | `PROOF-RESULT` with `invalid_nonce`        |

Other failures, such as an unreachable Proof API or database, propagate as exceptions.

---

See also: [x401](https://dev.proof.com/docs/x401) · [Pay with x402](https://dev.proof.com/docs/x401-signatures) · [x401 specification](https://x401.proof.com/spec/latest/) · [CONTRIBUTING.md](CONTRIBUTING.md)
