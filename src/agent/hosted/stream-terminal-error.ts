import { isRecord } from "../../chat/conversation.ts";
import { extractFinalStepTerminalError } from "../../chat/final-step-fallback.ts";
import { parseProviderError } from "../../chat/provider-errors.ts";

const EMPTY_RESPONSE_TERMINAL_ERROR_CODE = "EMPTY_RESPONSE";
const EMPTY_RESPONSE_TERMINAL_ERROR_MESSAGE = "Assistant completed without producing a response";
const EXTERNAL_SERVICE_ERROR_CODE = "EXTERNAL_SERVICE_ERROR";
const EXTERNAL_SERVICE_ERROR_MESSAGE = "LLM provider service error";
const STREAM_ERROR_TERMINAL_ERROR_CODE = "STREAM_ERROR";

/** Error shape for hosted stream terminal. */
export type HostedStreamTerminalError = {
  code: string;
  message: string;
};

function getUnknownErrorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (isRecord(error) && typeof error.message === "string") {
    return error.message;
  }

  return String(error);
}

function getHostedStreamTerminalError(streamError: unknown): HostedStreamTerminalError | null {
  if (streamError == null) {
    return null;
  }

  const parsedError = parseProviderError(streamError);
  if (
    parsedError.code !== EXTERNAL_SERVICE_ERROR_CODE ||
    parsedError.message !== EXTERNAL_SERVICE_ERROR_MESSAGE
  ) {
    return {
      code: parsedError.code,
      message: parsedError.message,
    };
  }

  const message = getUnknownErrorMessage(streamError).trim();
  if (message.length === 0) {
    return null;
  }

  return {
    code: STREAM_ERROR_TERMINAL_ERROR_CODE,
    message,
  };
}

/** Return hosted stream error text. */
export function getHostedStreamErrorText(streamError: unknown): string {
  return getHostedStreamTerminalError(streamError)?.message ?? getUnknownErrorMessage(streamError);
}

/** Error shape for get empty hosted finalized message terminal. */
export function getEmptyHostedFinalizedMessageTerminalError(input: {
  finalStep: unknown;
  streamError?: unknown | null;
}): HostedStreamTerminalError {
  return (
    getHostedStreamTerminalError(input.streamError) ??
      extractFinalStepTerminalError(input.finalStep) ?? {
      code: EMPTY_RESPONSE_TERMINAL_ERROR_CODE,
      message: EMPTY_RESPONSE_TERMINAL_ERROR_MESSAGE,
    }
  );
}

/** Message shape for should fail empty hosted finalized. */
export function shouldFailEmptyHostedFinalizedMessage(input: {
  isAborted: boolean;
  message: { parts: ReadonlyArray<unknown> };
}): boolean {
  return !input.isAborted && input.message.parts.length === 0;
}
