import { HEADER } from "@proof.com/x401-node";
import type { VPToken } from "@proof.com/proof-vc-server";
import { challenge } from "./challenge.ts";
import { rejected } from "./reject.ts";
import { verifyProofResponse } from "./verify.ts";
import { X401Error, type X401Options } from "./types.ts";

export async function handle(
  request: Request,
  options: X401Options,
): Promise<VPToken | Response> {
  const response = request.headers.get(HEADER.PROOF_RESPONSE);
  if (response === null) {
    return challenge(options);
  }
  try {
    return await verifyProofResponse(options, response);
  } catch (error) {
    if (error instanceof X401Error) {
      return rejected(error);
    }
    throw error;
  }
}
