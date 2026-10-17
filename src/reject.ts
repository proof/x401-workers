import { verifier as x401, HEADER } from "@proof.com/x401-node";
import type { X401Error } from "./types.ts";

export function rejected(error: X401Error): Response {
  return new Response(`${error.message}\n`, {
    status: error.status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      [HEADER.PROOF_RESULT]: x401.encodeErrorObject(
        x401.buildErrorObject({
          error: error.code,
          error_description: error.message,
        }),
      ),
    },
  });
}
