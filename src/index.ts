import { handle } from "./handle.ts";
import type { X401Handler, X401OptionsResolver } from "./types.ts";

export { agentsTrustListUrl } from "@proof.com/proof-vc-server";
export { X401Error } from "./types.ts";
export type {
  NonceStore,
  X401ErrorCode,
  X401Handler,
  X401Options,
  X401OptionsResolver,
} from "./types.ts";
export { clientMetadataDocument } from "./cimd.ts";
export { d1NonceStore } from "./stores/d1.ts";
export { kvNonceStore } from "./stores/kv.ts";

export function withX401(
  handler: X401Handler,
  resolveOptions: X401OptionsResolver,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const result = await handle(request, await resolveOptions(request));
    return result instanceof Response ? result : handler(request, result);
  };
}
