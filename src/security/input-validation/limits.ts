import { ValidationError } from "./errors.ts";
import { DEFAULT_LIMITS, type RequestLimits } from "./types.ts";

/** Validate request size limits (URL, headers, body) */
export function validateRequestLimits(
  request: Request,
  limits: RequestLimits = {},
): void {
  const config = { ...DEFAULT_LIMITS, ...limits };

  validateUrlLength(request.url, config.maxUrlLength);
  validateContentLength(request, config.maxBodySize);
  validateHeaderSize(request, config.maxHeaderSize);
}

function validateUrlLength(url: string, maxLength: number): void {
  if (url.length > maxLength) {
    throw new ValidationError("URL too long", {
      maxLength,
      actualLength: url.length,
    });
  }
}

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

function validateHeaderSize(request: Request, maxSize: number): void {
  let headerSize = 0;

  for (const [key, value] of request.headers) {
    headerSize += key.length + value.length + 4; // ": " and "\r\n"
  }

  if (headerSize > maxSize) {
    throw new ValidationError("Headers too large", {
      maxSize,
      actualSize: headerSize,
    });
  }
}

/** Read request body with size limit enforcement */
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
