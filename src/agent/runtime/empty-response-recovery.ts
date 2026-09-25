export const EMPTY_RESPONSE_ERROR_CODE = "EMPTY_RESPONSE";
export const EMPTY_RESPONSE_ERROR_MESSAGE = "Assistant completed without producing a response";
export const EMPTY_RESPONSE_RECOVERY_PROMPT =
  "Runtime recovery: the previous model turn stopped without producing a response. Continue from the existing tool results and complete the user's request. Do not repeat completed tool calls.";

/** Terminal failure after the model exhausts the bounded empty-response recovery. */
export class RuntimeEmptyResponseError extends Error {
  readonly code = EMPTY_RESPONSE_ERROR_CODE;

  constructor() {
    super(EMPTY_RESPONSE_ERROR_MESSAGE);
    this.name = "RuntimeEmptyResponseError";
  }
}

/** Identify the runtime-owned empty-response failure without trusting error text. */
export function isRuntimeEmptyResponseError(error: unknown): error is RuntimeEmptyResponseError {
  try {
    return error instanceof RuntimeEmptyResponseError;
  } catch {
    return false;
  }
}
