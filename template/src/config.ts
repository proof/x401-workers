import type { X401Options } from "@proof.com/x401-workers";

type Environment = NonNullable<X401Options["environment"]>;

const ENVIRONMENTS: readonly Environment[] = ["production", "sandbox"];

export type Config = {
  clientId: string;
  clientName: string;
  environment: Environment;
  scope: string;
  signingJwk: JsonWebKey;
};

export class ConfigError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`Invalid configuration:\n- ${problems.join("\n- ")}`);
    this.problems = problems;
  }
}

function parseJwk(value: string | undefined): JsonWebKey | undefined {
  try {
    const jwk: unknown = JSON.parse(value ?? "");
    return typeof jwk === "object" && jwk !== null && "kty" in jwk
      ? (jwk as JsonWebKey)
      : undefined;
  } catch {
    return undefined;
  }
}

export function readConfig(env: Env): Config {
  const problems: string[] = [];
  for (const name of [
    "X401_CLIENT_ID",
    "X401_CLIENT_NAME",
    "X401_SCOPE",
  ] as const) {
    if (!env[name]) {
      problems.push(`${name} is not set`);
    }
  }
  const environment = ENVIRONMENTS.find((e) => e === env.X401_ENVIRONMENT);
  if (environment === undefined) {
    problems.push(`X401_ENVIRONMENT must be one of ${ENVIRONMENTS.join(", ")}`);
  }
  const signingJwk = parseJwk(env.SIGNING_JWK);
  if (signingJwk === undefined) {
    problems.push("SIGNING_JWK is not set to a JSON Web Key");
  }
  if (
    environment === undefined ||
    signingJwk === undefined ||
    problems.length > 0
  ) {
    throw new ConfigError(problems);
  }
  return {
    clientId: env.X401_CLIENT_ID,
    clientName: env.X401_CLIENT_NAME,
    environment,
    scope: env.X401_SCOPE,
    signingJwk,
  };
}
