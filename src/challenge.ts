import {
  verifier as x401,
  DC_API_PROTOCOL,
  HEADER,
} from "@proof.com/x401-node";
import { createClient } from "@proof.com/proof-vc-server";
import { DEFAULT_ENVIRONMENT, type X401Options } from "./types.ts";

export async function challenge(options: X401Options): Promise<Response> {
  const client = createClient({
    environment: options.environment ?? DEFAULT_ENVIRONMENT,
    clientId: options.clientId,
    useSecuredAuthorizationRequest: true,
    privateKeyFactory: options.privateKeyFactory,
  });
  const request = await client.signedDcApiRequest({
    scope: options.scope,
    nonce: await options.nonceStore.mint(),
    expectedOrigins: options.expectedOrigins as [string, ...string[]],
  });
  const payload = x401.buildPayload({
    credentialRequirements: {
      digital: {
        requests: [{ protocol: DC_API_PROTOCOL.SIGNED, data: { request } }],
      },
    },
  });
  const encoded = x401.encodePayload(payload);
  return new Response(null, {
    status: 401,
    headers: {
      "cache-control": "no-store",
      [HEADER.PROOF_REQUEST]: encoded,
    },
  });
}
