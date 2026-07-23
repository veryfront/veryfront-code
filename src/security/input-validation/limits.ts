import { createValidationError, VeryfrontError } from "./errors.ts";
import { DEFAULT_LIMITS, type RequestLimits } from "./types.ts";

const REQUEST_BODY_TOO_LARGE_DETAIL = "Request body exceeds size limit";
const DECLARED_BODY_TOO_LARGE_DETAIL = "Request body too large";
const textEncoder = new TextEncoder();

function validateLimit(name: string, value: number): void {
  if (Number.isSafeInteger(value) && value >= 0) return;
  throw createValidationError(
    `Invalid request limit: ${name} must be a non-negative safe integer`,
    { name, value: Number.isFinite(value) ? value : String(value) },
  );
}

export function isRequestBodyTooLargeError(error: unknown): error is VeryfrontError {
  return error instanceof VeryfrontError &&
    error.slug === "input-validation-failed" &&
    (error.detail === REQUEST_BODY_TOO_LARGE_DETAIL ||
      error.detail === DECLARED_BODY_TOO_LARGE_DETAIL);
}

export function validateRequestLimits(
  request: Request,
  limits: RequestLimits = {},
): void {
  const { maxUrlLength, maxBodySize, maxHeaderSize } = {
    ...DEFAULT_LIMITS,
    ...limits,
  };

  validateLimit("maxUrlLength", maxUrlLength);
  validateLimit("maxBodySize", maxBodySize);
  validateLimit("maxHeaderSize", maxHeaderSize);

  validateUrlLength(request.url, maxUrlLength);
  validateContentLength(request, maxBodySize);
  validateHeaderSize(request, maxHeaderSize);
}

function validateUrlLength(url: string, maxLength: number): void {
  const actualLength = textEncoder.encode(url).byteLength;
  if (actualLength <= maxLength) return;

  throw createValidationError("URL too long", {
    maxLength,
    actualLength,
  });
}

function validateContentLength(request: Request, maxSize: number): void {
  const contentLength = request.headers.get("content-length");
  if (contentLength === null) return;

  if (!/^\d+$/.test(contentLength)) {
    throw createValidationError("Invalid Content-Length header");
  }
  const size = Number(contentLength);
  if (!Number.isSafeInteger(size)) {
    throw createValidationError("Invalid Content-Length header");
  }
  if (size <= maxSize) return;

  throw createValidationError(DECLARED_BODY_TOO_LARGE_DETAIL, {
    maxSize,
    actualSize: size,
  });
}

function validateHeaderSize(request: Request, maxSize: number): void {
  let headerSize = 0;

  for (const [key, value] of request.headers) {
    headerSize += textEncoder.encode(key).byteLength + textEncoder.encode(value).byteLength + 4;
  }

  if (headerSize <= maxSize) return;

  throw createValidationError("Headers too large", {
    maxSize,
    actualSize: headerSize,
  });
}

export function validateContentType(request: Request, expected: string | string[]): void {
  const allowed = Array.isArray(expected) ? expected : [expected];
  const label = allowed.join(" or ");
  const contentType = request.headers.get("content-type");
  if (!contentType) {
    throw createValidationError(`Missing Content-Type header, expected ${label}`);
  }
  const mediaType = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!allowed.includes(mediaType)) {
    throw createValidationError(`Invalid Content-Type: expected ${label}`, {
      expected: allowed,
      actual: contentType,
    });
  }
}

export async function readBodyWithLimit(
  request: Request,
  maxSize: number = DEFAULT_LIMITS.maxBodySize,
): Promise<string> {
  const bytes = await readBodyBytesWithLimit(request, maxSize);
  return new TextDecoder().decode(bytes);
}

/** Read a request body as bytes while enforcing the configured limit. @internal */
export async function readBodyBytesWithLimit(
  request: Request,
  maxSize: number = DEFAULT_LIMITS.maxBodySize,
): Promise<Uint8Array> {
  validateLimit("maxBodySize", maxSize);

  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) {
      throw createValidationError("Invalid Content-Length header");
    }
    const declaredSize = Number(contentLength);
    if (!Number.isSafeInteger(declaredSize)) {
      throw createValidationError("Invalid Content-Length header");
    }
    if (declaredSize > maxSize) {
      throw createValidationError(REQUEST_BODY_TOO_LARGE_DETAIL, {
        maxSize,
        contentLength: declaredSize,
      });
    }
  }

  const reader = request.body?.getReader();
  if (!reader) throw createValidationError("No request body");

  const chunks: Uint8Array[] = [];
  let totalSize = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalSize += value.length;
      if (totalSize > maxSize) {
        await reader.cancel().catch(() => undefined);
        throw createValidationError(REQUEST_BODY_TOO_LARGE_DETAIL, {
          maxSize,
          bytesRead: totalSize,
        });
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const combined = new Uint8Array(totalSize);
  let offset = 0;

  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  return combined;
}
