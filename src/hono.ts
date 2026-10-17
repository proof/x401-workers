import type { Context, Env, MiddlewareHandler } from "hono";
import type { VPToken } from "@proof.com/proof-vc-server";
import { handle } from "./handle.ts";
import type { X401Options } from "./types.ts";

export type X401Variables = { x401: VPToken };

export function x401<E extends Env = Env>(
  resolveOptions: (c: Context<E>) => X401Options | Promise<X401Options>,
): MiddlewareHandler<E & { Variables: X401Variables }> {
  return async (c, next) => {
    const result = await handle(
      c.req.raw,
      await resolveOptions(c as unknown as Context<E>),
    );
    if (result instanceof Response) {
      return result;
    }
    c.set("x401", result);
    await next();
  };
}
