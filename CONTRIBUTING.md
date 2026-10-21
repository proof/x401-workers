# Contributing

## Requirements

- `node` >= 22.0.0 (published floor, `engines.node`). Develop on Node 24 (active LTS), pinned in [.node-version](.node-version).
- `yarn` 4 - run `corepack enable`; the version is pinned via `packageManager` in `package.json`.

## Design Principles

`@proof.com/x401-workers` is the thinnest possible x401 verifier for Cloudflare Workers:

- **Spec-minimal.** It issues the `PROOF-REQUEST` challenge, verifies the `PROOF-RESPONSE`, and
  enforces single-use nonces. No defaults, no extra checks beyond the x401 spec and the SDK calls.
- **Web standard only.** `Request`, `Response`, `fetch`, `crypto`. No Node built-ins, no framework
  dependency in the core. Framework adapters live in subpath exports and contain no logic.
- **Storage is pluggable.** `NonceStore` is two methods; D1 and KV implementations are provided.

## Commands

- `yarn build`
- `yarn format`
- `yarn lint`
- `yarn typecheck`
- `yarn test`
- `yarn publint`

## Template

`template/` is a standalone npm project. After changing it, run `npm run check` and `npm test` in
`template/`, and `npm run cf-typegen` if `wrangler.jsonc` changed.

## Pull Requests

- Branch off `main`, keep changes focused, explain what changed and why.
- CI runs `format`, `lint`, `typecheck`, `test` (Node 22 and 24), `build` and `publint`; all are required on `main`.

## Code of conduct

This project follows the [Contributor Covenant Code of Conduct](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). By participating, you are expected to uphold this standard.
