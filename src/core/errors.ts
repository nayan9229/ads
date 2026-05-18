export const ErrorCode = {
  E_CONFIG_INVALID: "E_CONFIG_INVALID",
  E_NO_CMP: "E_NO_CMP",
  E_TIMEOUT: "E_TIMEOUT",
  E_BIDDER_FAIL: "E_BIDDER_FAIL",
  E_RENDER_FAIL: "E_RENDER_FAIL",
  E_RENDER_TIMEOUT: "E_RENDER_TIMEOUT",
  E_PREBID_LOAD_FAIL: "E_PREBID_LOAD_FAIL",
  E_IMA_LOAD_FAIL: "E_IMA_LOAD_FAIL",
  E_IDENTITY_LOAD_FAIL: "E_IDENTITY_LOAD_FAIL",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export class WrapperError extends Error {
  readonly code: ErrorCode;
  readonly context: Readonly<Record<string, unknown>>;

  constructor(code: ErrorCode, message: string, context: Record<string, unknown> = {}) {
    super(message);
    this.name = "WrapperError";
    this.code = code;
    this.context = Object.freeze({ ...context });
  }
}

export class ConfigError extends WrapperError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(ErrorCode.E_CONFIG_INVALID, message, context);
    this.name = "ConfigError";
  }
}
