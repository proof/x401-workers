import {
  agentsTrustListUrl,
  clientMetadataDocument,
  d1NonceStore,
  withX401,
  type X401Options,
} from "@proof.com/x401-workers";
import { ConfigError, readConfig, type Config } from "./config.ts";

const CIMD_PATH = "/.well-known/proof-client.json";
const PROTECTED_PATH = "/protected";

const options = (env: Env, config: Config): X401Options => ({
  clientId: config.clientId,
  privateKeyFactory: () => config.signingJwk,
  nonceStore: d1NonceStore(env.DB),
  scope: config.scope,
  environment: config.environment,
  expectedOrigins: [agentsTrustListUrl(config.environment)],
});

function landing(request: Request, env: Env): Response {
  const lines = [
    "x401 Verifier",
    "",
    `GET ${PROTECTED_PATH} answers 401 with a PROOF-REQUEST header.`,
    "An agent connected to Proof's MCP server presents the user's credential and retries with PROOF-RESPONSE.",
    `Client ID Metadata Document: ${new URL(CIMD_PATH, request.url)}`,
    "Specification: https://x401.proof.com/spec/latest/",
  ];
  try {
    readConfig(env);
  } catch (error) {
    if (!(error instanceof ConfigError)) {
      throw error;
    }
    lines.push(
      "",
      error.message,
      "",
      "Run `npm run setup` to configure and deploy this Worker.",
    );
  }
  return new Response(`${lines.join("\n")}\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

async function route(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname === CIMD_PATH) {
    const config = readConfig(env);
    return clientMetadataDocument({
      ...options(env, config),
      clientName: config.clientName,
    });
  }
  if (pathname === PROTECTED_PATH) {
    const config = readConfig(env);
    return withX401(
      (_request, presentation) =>
        Response.json(
          Object.fromEntries(
            Object.entries(presentation).map(([id, credentials]) => [
              id,
              credentials.map((credential) => credential.toJSON()),
            ]),
          ),
        ),
      () => options(env, config),
    )(request);
  }
  return new Response("Not found\n", { status: 404 });
}

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname === "/") {
      return landing(request, env);
    }
    try {
      return await route(request, env);
    } catch (error) {
      if (error instanceof ConfigError) {
        return new Response(`${error.message}\n`, { status: 500 });
      }
      throw error;
    }
  },
} satisfies ExportedHandler<Env>;
