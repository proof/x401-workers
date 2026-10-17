import { createClientIdMetadataDocument } from "@proof.com/proof-vc-server";
import { DEFAULT_ENVIRONMENT, type X401Options } from "./types.ts";

type ClientMetadataOptions = Pick<
  X401Options,
  "clientId" | "privateKeyFactory" | "expectedOrigins" | "environment"
> & { clientName: string };

export async function clientMetadataDocument(
  options: ClientMetadataOptions,
): Promise<Response> {
  const key = await options.privateKeyFactory();
  if (!("kty" in key)) {
    throw new Error(
      "privateKeyFactory must return a JWK to publish its public part",
    );
  }
  const { d: _d, ...publicJwk } = key;
  const document = await createClientIdMetadataDocument({
    environment: options.environment ?? DEFAULT_ENVIRONMENT,
    clientId: options.clientId,
    clientName: options.clientName,
    redirectUris: options.expectedOrigins,
    jwks: [publicJwk],
  });
  return Response.json(document);
}
