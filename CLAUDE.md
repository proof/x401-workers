# @proof.com/x401-workers - AI Assistant Guide

ESM TypeScript library: x401 verifier middleware for Cloudflare Workers. It wraps a `fetch`
handler with the x401 challenge/response flow (https://x401.proof.com/spec/latest/) using
`@proof.com/x401-node` for the wire format and `@proof.com/proof-vc-server` for presentation
verification.

## Hard Rules

1. **Spec-minimal.** No defaults, no checks beyond what the x401 spec or the SDK calls require. If a
   check is a SHOULD, leave it to the consumer.
2. **Web standard only in `src/`.** `Request`, `Response`, `fetch`, `crypto`. No `node:*` imports.
   Cloudflare binding types are imported as types from `@cloudflare/workers-types` only inside
   `src/stores/`.
3. **Adapters contain no logic.** `src/hono.ts` and any future adapter call `handle` from the
   core and nothing else.
4. **Prompt before publishing.** Never bump version, push tags, create a Release, or trigger the
   publish workflow without explicit confirmation.
5. **Run `yarn check-all` before any commit or push.**
6. **Never use `eslint-disable`, `@ts-ignore`, or `@ts-expect-error` as a workaround.**

## TypeScript Conventions

- `verbatimModuleSyntax: true` — use `import type` / `export type`.
- `exactOptionalPropertyTypes: true` — set optional fields with conditional spread.
- Local imports use the `.ts` extension (`rewriteRelativeImportExtensions` rewrites to `.js`).

## Source Map

- `src/types.ts` — `NonceStore`, `X401Options`, `X401Error`, handler and resolver types.
- `src/challenge.ts` — builds the signed OpenID4VP request and the `401` + `PROOF-REQUEST` response.
- `src/verify.ts` — decodes `PROOF-RESPONSE`, dereferences `credential_result_uri`, verifies the
  presentation with Proof, consumes the nonce.
- `src/handle.ts` — `handle(request, options)`: the challenge/verify/reject flow shared by the
  adapters; returns the verified `VPToken` or a `Response`.
- `src/reject.ts` — the `PROOF-RESULT` error response.
- `src/cimd.ts` — `clientMetadataDocument`, the Client ID Metadata Document from the same options.
- `src/index.ts` — `withX401` and the public barrel (nothing else is public).
- `src/stores/d1.ts`, `src/stores/kv.ts` — `NonceStore` implementations.
- `src/hono.ts` — Hono middleware, exported as `@proof.com/x401-workers/hono`.
- `template/` — C3 / Deploy button template (`npm create cloudflare -- --template=proof/x401-workers/template`).
  A standalone npm project depending on the published package; it uses only the public API. Its
  config validation and `scripts/setup.mjs` are template-only and add no library defaults. Tested
  by the `template` job in `.github/workflows/ci.yml`; `yarn check-all` only formats and lints it.

## Publishing

Same flow as `@proof.com/x401-node`: bump on a `release-X.Y.Z` branch, merge, then
`gh release create vX.Y.Z --target <merged sha> --generate-notes`. The Release triggers
`publish.yml` (npm Trusted Publishing, `npm publish --provenance --access public`).
On every release, bump `@proof.com/x401-workers` in `template/package.json` (on 0.x, `^0.1.0` does
not accept `0.2.0`) and refresh `template/package-lock.json`.
