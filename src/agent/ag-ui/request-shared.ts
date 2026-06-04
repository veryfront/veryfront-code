import { INVALID_ARGUMENT } from "#veryfront/errors";

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
): Promise<T | Response> {
  try {
    return await parseRequest();
  } catch (error) {
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

    if (error instanceof SyntaxError || error instanceof TypeError) {
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
