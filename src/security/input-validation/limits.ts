/**
 * Request Limit Validators
 * Functions for validating request size limits
 */

import { ValidationError } from "./errors.ts";
import { DEFAULT_LIMITS, type RequestLimits } from "./types.ts";

/**
 * Validate request size limits (URL, headers, body)
 *
 * @param request - Request object to validate
 * @param limits - Optional custom size limits
 * @throws ValidationError if any limit is exceeded
 *
 * @example
 * ```ts
 * validateRequestLimits(request, {
 *   maxUrlLength: 1024,
 *   maxBodySize: 512 * 1024
 * })
 * ```
 */
export function validateRequestLimits(
  request: Request,
  limits: RequestLimits = {},
): void {
  const config = { ...DEFAULT_LIMITS, ...limits };

  validateUrlLength(request.url, config.maxUrlLength);
  validateContentLength(request, config.maxBodySize);
  validateHeaderSize(request, config.maxHeaderSize);
}

/**
 * Validate URL length
 *
 * @param url - URL to validate
 * @param maxLength - Maximum allowed URL length
 * @throws ValidationError if URL is too long
 */
function validateUrlLength(url: string, maxLength: number): void {
  if (url.length > maxLength) {
    throw new ValidationError("URL too long", {
      maxLength,
      actualLength: url.length,
    });
  }
}

/**
 * Validate Content-Length header
 *
 * @param request - Request object with headers
 * @param maxSize - Maximum allowed body size
 * @throws ValidationError if Content-Length is invalid or too large
 */
function validateContentLength(request: Request, maxSize: number): void {
  const contentLength = request.headers.get("content-length");
  if (!contentLength) return;

  const size = parseInt(contentLength, 10);
  if (isNaN(size)) {
    throw new ValidationError("Invalid Content-Length header");
  }

  if (size > maxSize) {
    throw new ValidationError("Request body too large", {
      maxSize,
      actualSize: size,
    });
  }
}

/**
 * Validate total header size (approximate)
 *
 * @param request - Request object with headers
 * @param maxSize - Maximum allowed header size
 * @throws ValidationError if headers are too large
 */
function validateHeaderSize(request: Request, maxSize: number): void {
  let headerSize = 0;

  request.headers.forEach((value, key) => {
    headerSize += key.length + value.length + 4; // ": " and "\r\n"
  });

  if (headerSize > maxSize) {
    throw new ValidationError("Headers too large", {
      maxSize,
      actualSize: headerSize,
    });
  }
}

/**
 * Read request body with size limit enforcement
 *
 * @param request - Request object with body stream
 * @param maxSize - Maximum allowed body size
 * @returns Body content as string
 * @throws ValidationError if body exceeds size limit
 *
 * @example
 * ```ts
 * const body = await readBodyWithLimit(request, 1024 * 1024) // 1MB limit
 * ```
 */
export async function readBodyWithLimit(
  request: Request,
  maxSize: number = DEFAULT_LIMITS.maxBodySize,
): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) {
    throw new ValidationError("No request body");
  }

  const chunks: Uint8Array[] = [];
  let totalSize = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalSize += value.length;
      if (totalSize > maxSize) {
        throw new ValidationError("Request body exceeds size limit", {
          maxSize,
          bytesRead: totalSize,
        });
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  // Combine chunks and decode
  const combined = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  return new TextDecoder().decode(combined);
}
