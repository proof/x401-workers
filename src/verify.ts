import { verifier as x401, type ResultArtifact } from "@proof.com/x401-node";
import { ProofVCError } from "@proof.com/proof-vc-common";
import { createVerifier, type VPToken } from "@proof.com/proof-vc-server";
import { DEFAULT_ENVIRONMENT, X401Error, type X401Options } from "./types.ts";

const CREDENTIAL_RESULT_FETCH_TIMEOUT_MS = 5000;

const REJECTED_PRESENTATION_CODES: ReadonlySet<string> = new Set([
  "invalid_input",
  "verification_failed",
]);

function invalidResponse(cause: unknown): X401Error {
  return new X401Error("invalid_response", { cause });
}

// TODO: bound the size of the fetched credential result (the spec says the Verifier SHOULD).
async function fetchCredentialResult(uri: string): Promise<unknown> {
  try {
    const response = await fetch(uri, {
      signal: AbortSignal.timeout(CREDENTIAL_RESULT_FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`credential_result_uri answered HTTP ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    throw invalidResponse(error);
  }
}

function assertNotExpired(artifact: ResultArtifact): void {
  if (artifact.expires_at === undefined) {
    return;
  }
  const expiresAt = Date.parse(artifact.expires_at);
  if (Number.isNaN(expiresAt) || expiresAt <= Date.now()) {
    throw invalidResponse(
      new Error(`credential_result_uri expired at ${artifact.expires_at}`),
    );
  }
}

async function vpTokenFromResponse(
  options: X401Options,
  response: string,
): Promise<string> {
  let artifact: ResultArtifact;
  try {
    artifact = x401.decodeResultArtifact(response, {
      allowInsecureUri: options.allowInsecureUri ?? false,
    });
  } catch (error) {
    throw invalidResponse(error);
  }
  assertNotExpired(artifact);
  const result: unknown =
    artifact.credential_result_uri === undefined
      ? artifact.credential_result
      : await fetchCredentialResult(artifact.credential_result_uri);
  const data =
    typeof result === "object" && result !== null && "data" in result
      ? result.data
      : undefined;
  const vpToken =
    typeof data === "object" && data !== null && "vp_token" in data
      ? data.vp_token
      : undefined;
  if (typeof vpToken !== "string" || vpToken.length === 0) {
    throw invalidResponse(
      new Error("credential result carries no vp_token string"),
    );
  }
  return vpToken;
}

async function consumeNonce(
  options: X401Options,
  presentation: VPToken,
): Promise<void> {
  const credentials = Object.values(presentation).flat();
  if (credentials.length === 0) {
    throw new X401Error("invalid_result", {
      cause: new Error("presentation contains no credential"),
    });
  }
  const nonces = new Set(
    credentials.map((credential) => credential.getNonce()),
  );
  const [nonce] = nonces;
  if (nonces.size !== 1 || nonce === undefined) {
    throw new X401Error("invalid_nonce");
  }
  if (!(await options.nonceStore.verify(nonce))) {
    throw new X401Error("invalid_nonce");
  }
}

export async function verifyProofResponse(
  options: X401Options,
  response: string,
): Promise<VPToken> {
  const encodedVPToken = await vpTokenFromResponse(options, response);
  const proofVerifier = createVerifier({
    environment: options.environment ?? DEFAULT_ENVIRONMENT,
    clientId: options.clientId,
    privateKeyFactory: options.privateKeyFactory,
    ...(options.fetch !== undefined && { fetch: options.fetch }),
  });
  let presentation: VPToken;
  try {
    presentation = await proofVerifier.verifyVPToken({
      encodedVPToken,
      aud: options.clientId,
    });
  } catch (error) {
    if (
      error instanceof ProofVCError &&
      REJECTED_PRESENTATION_CODES.has(error.code)
    ) {
      throw new X401Error("invalid_result", { cause: error });
    }
    throw error;
  }
  await consumeNonce(options, presentation);
  return presentation;
}
