import { INVALID_ARGUMENT, VeryfrontError } from "#veryfront/errors";
import {
  isRequestBodyTooLargeError,
  readBodyBytesWithLimit,
  readBodyWithLimit,
} from "#veryfront/security/input-validation/limits.ts";
import { assertNativeRequestDefaults } from "#veryfront/security/http/native-request-processing.ts";
import { DEFAULT_MAX_BODY_SIZE_BYTES } from "#veryfront/utils/constants/index.ts";

const IntrinsicReflectApply = Reflect.apply;
const JsonParse = JSON.parse;
const NativeRequest = Request;
const RequestBodyGet = Object.getOwnPropertyDescriptor(NativeRequest.prototype, "body")!.get!;
const fatalUtf8Decoder = new TextDecoder("utf-8", { fatal: true });
const FatalUtf8Decode = (bytes: Uint8Array): string => fatalUtf8Decoder.decode(bytes);

export const AG_UI_MAX_REQUEST_BODY_BYTES = DEFAULT_MAX_BODY_SIZE_BYTES;

/**
 * Bound incoming bytes before exposing a body to application callbacks.
 *
 * The bound is applied over bytes rather than text. Cancellation carries no
 * JSON payload, so decoding here would reject an opaque body -- a body-bound
 * signature over raw bytes, say -- before authentication or authorization ever
 * saw it. Callers whose payload must be JSON pass `requireUtf8Body` so a
 * malformed body is still refused as a validation error rather than reaching
 * those callbacks.
 */
export async function boundAgUiRequestBody(
  request: Request,
  errorLabel: string,
  allowEmptyBody = false,
  requireUtf8Body = false,
): Promise<Request | Response> {
  return await parseAgUiJsonRequestOrError(async () => {
    if (allowEmptyBody && IntrinsicReflectApply(RequestBodyGet, request, []) === null) {
      return request;
    }
    const body = await readBodyBytesWithLimit(request, AG_UI_MAX_REQUEST_BODY_BYTES);
    if (requireUtf8Body) {
      FatalUtf8Decode(body);
    }
    assertNativeRequestDefaults();
    // The bytes are a BufferSource; the cast only narrows the buffer-backing
    // type parameter that `BodyInit` spells more strictly than the reader does.
    return new NativeRequest(request, { body: body as BodyInit });
  }, errorLabel);
}

export async function parseAgUiJsonBody(request: Request): Promise<unknown> {
  return IntrinsicReflectApply(
    JsonParse,
    JSON,
    [await readBodyWithLimit(request, AG_UI_MAX_REQUEST_BODY_BYTES)],
  );
}

export function createAgUiBodyLimitErrorResponse(
  error: unknown,
  errorLabel: string,
): Response | undefined {
  if (!isRequestBodyTooLargeError(error)) {
    return undefined;
  }

  return Response.json(
    {
      error: errorLabel,
      details: [{
        path: [],
        message: `Request body exceeds ${AG_UI_MAX_REQUEST_BODY_BYTES} bytes`,
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
): Promise<T | Response> {
  try {
    return await parseRequest();
  } catch (error) {
    const bodyLimitError = createAgUiBodyLimitErrorResponse(error, errorLabel);
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
