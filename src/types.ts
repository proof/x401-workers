import type { Environment } from "@proof.com/proof-vc-common";
import type { PrivateKeyFactory, VPToken } from "@proof.com/proof-vc-server";

export interface NonceStore {
  mint(): Promise<string>;
  verify(nonce: string): Promise<boolean>;
}

export type X401ErrorCode =
  "invalid_response" | "invalid_result" | "invalid_nonce";

const ERROR_STATUS: Record<X401ErrorCode, number> = {
  invalid_response: 400,
  invalid_result: 401,
  invalid_nonce: 401,
};

const ERROR_DESCRIPTION: Record<X401ErrorCode, string> = {
  invalid_response:
    "PROOF-RESPONSE is malformed or its credential result could not be fetched",
  invalid_result: "The presentation was rejected",
  invalid_nonce: "The challenge nonce is unknown, expired or already used",
};

export class X401Error extends Error {
  readonly status: number;
  readonly code: X401ErrorCode;

  constructor(code: X401ErrorCode, options?: { cause?: unknown }) {
    super(ERROR_DESCRIPTION[code], options);
    this.status = ERROR_STATUS[code];
    this.code = code;
  }
}

export type X401Options = {
  clientId: string;
  privateKeyFactory: PrivateKeyFactory;
  nonceStore: NonceStore;
  scope: string;
  expectedOrigins: string[];
  environment?: Environment;
  allowInsecureUri?: boolean;
  fetch?: typeof globalThis.fetch;
};

export const DEFAULT_ENVIRONMENT: Environment = "production";

export type X401Handler = (
  request: Request,
  presentation: VPToken,
) => Response | Promise<Response>;

export type X401OptionsResolver = (
  request: Request,
) => X401Options | Promise<X401Options>;
