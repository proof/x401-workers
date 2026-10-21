# x401 Verifier on Cloudflare Workers

A Worker that protects `/protected` with [x401](https://x401.proof.com/spec/latest/).

```sh
npm create cloudflare@latest -- my-verifier --template=proof/x401-workers/template
cd my-verifier
npm run setup                  # sandbox, on workers.dev
npm run setup -- --production  # production, on a domain of a zone in your Cloudflare account
```

`setup` deploys the Worker and enrolls it on Proof; for production, the enrollment email must be on
the Worker's domain. Follow the activation email, then ask an agent connected to Proof's MCP server
to fetch `https://<your worker>/protected`. Add `--fresh` to discard an environment's signing key,
client id and enrollment and start over.
