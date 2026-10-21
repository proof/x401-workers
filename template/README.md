# x401-workers Cloudflare Template

A Cloudflare Worker that protects `/protected` with [x401](https://x401.proof.com/spec/latest/),
built on [`@proof.com/x401-workers`](https://github.com/proof/x401-workers).

## 🚀 Get started

```sh
npm create cloudflare@latest -- my-verifier --template=proof/x401-workers/template
cd my-verifier
npm run setup                  # sandbox, on workers.dev
npm run setup -- --production  # production, on a domain of a zone in your Cloudflare account
```

`setup` deploys the Worker and enrolls it on Proof; for production, the enrollment email must be on
the Worker's domain.

## Try it

1. Follow the activation email from Proof.
2. Ask an agent connected to Proof's MCP server to fetch `https://<your worker>/protected`.

## Start over

Run `npm run setup -- --fresh` to discard the signing key, client id and start the setup again.
