import { INVALID_ARGUMENT, VeryfrontError } from "#veryfront/errors";
import { DEFAULT_LIMITS } from "#veryfront/security/input-validation/types.ts";
import {
  isRequestBodyTooLargeError,
  readBodyWithLimit,
} from "#veryfront/security/input-validation/limits.ts";

export const AG_UI_MAX_REQUEST_BODY_BYTES = DEFAULT_LIMITS.maxBodySize;

export async function parseAgUiJsonBody(
  request: Request,
  maxBodySizeBytes = AG_UI_MAX_REQUEST_BODY_BYTES,
): Promise<unknown> {
  return JSON.parse(await readBodyWithLimit(request, maxBodySizeBytes));
}

export function createAgUiBodyLimitErrorResponse(
  error: unknown,
  errorLabel: string,
  maxBodySizeBytes = AG_UI_MAX_REQUEST_BODY_BYTES,
): Response | undefined {
  if (!isRequestBodyTooLargeError(error)) {
    return undefined;
  }

  return Response.json(
    {
      error: errorLabel,
      details: [{
        path: [],
        message: `Request body exceeds ${maxBodySizeBytes} bytes`,
      }],
    },
    { status: 413 },
  );
}

/**
 * Detects a validation error thrown by a `Schema.parse()` call. Works with
 * the contract-DSL adapter, which exposes validation issues on thrown errors.
 */
function isSchemaValidationError(
  error: unknown,
): error is Error & { issues: ReadonlyArray<{ path: (string | number)[]; message: string }> } {
  return (
    error instanceof Error &&
    "issues" in error &&
    Array.isArray((error as Record<string, unknown>).issues)
  );
}

function isInputValidationError(error: unknown): error is VeryfrontError {
  return error instanceof VeryfrontError && error.slug === "input-validation-failed";
}

export function isRequest(value: unknown): value is Request {
  return (
    typeof value === "object" &&
    value !== null &&
    "json" in value &&
    typeof value.json === "function" &&
    "url" in value &&
    typeof value.url === "string" &&
    "method" in value &&
    typeof value.method === "string"
  );
}

export function extractRequest(requestOrCtx: unknown): Request {
  if (isRequest(requestOrCtx)) return requestOrCtx;

  if (typeof requestOrCtx === "object" && requestOrCtx !== null && "request" in requestOrCtx) {
    const candidate = (requestOrCtx as Record<string, unknown>).request;
    if (isRequest(candidate)) return candidate;
  }

  throw INVALID_ARGUMENT.create({
    detail: "Invalid handler argument: expected Request or APIContext",
  });
}

export async function parseAgUiJsonRequestOrError<T>(
  parseRequest: () => Promise<T>,
  errorLabel: string,
  maxBodySizeBytes = AG_UI_MAX_REQUEST_BODY_BYTES,
): Promise<T | Response> {
  try {
    return await parseRequest();
  } catch (error) {
    const bodyLimitError = createAgUiBodyLimitErrorResponse(error, errorLabel, maxBodySizeBytes);
    if (bodyLimitError) return bodyLimitError;

    if (isSchemaValidationError(error)) {
      return Response.json(
        {
          error: errorLabel,
          details: error.issues.map((issue) => ({
            path: issue.path,
            message: issue.message,
          })),
        },
        { status: 400 },
      );
    }

    if (
      error instanceof SyntaxError || error instanceof TypeError || isInputValidationError(error)
    ) {
      return Response.json(
        {
          error: errorLabel,
          details: [{ path: [], message: "Malformed JSON request body" }],
        },
        { status: 400 },
      );
    }

    throw error;
  }
}
