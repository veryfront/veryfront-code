import { ValidationError } from "./errors.ts";
import { DEFAULT_LIMITS, type RequestLimits } from "./types.ts";

export function validateRequestLimits(
  request: Request,
  limits: RequestLimits = {},
): void {
  const { maxUrlLength, maxBodySize, maxHeaderSize } = {
    ...DEFAULT_LIMITS,
    ...limits,
  };

  validateUrlLength(request.url, maxUrlLength);
  validateContentLength(request, maxBodySize);
  validateHeaderSize(request, maxHeaderSize);
}

function validateUrlLength(url: string, maxLength: number): void {
  if (url.length <= maxLength) return;

  throw new ValidationError("URL too long", {
    maxLength,
    actualLength: url.length,
  });
}

function validateContentLength(request: Request, maxSize: number): void {
  const contentLength = request.headers.get("content-length");
  if (!contentLength) return;

  const size = Number.parseInt(contentLength, 10);
  if (Number.isNaN(size)) throw new ValidationError("Invalid Content-Length header");
  if (size <= maxSize) return;

  throw new ValidationError("Request body too large", {
    maxSize,
    actualSize: size,
  });
}

function validateHeaderSize(request: Request, maxSize: number): void {
  let headerSize = 0;

  for (const [key, value] of request.headers) {
    headerSize += key.length + value.length + 4; // ": " and "\r\n"
  }

  if (headerSize <= maxSize) return;

  throw new ValidationError("Headers too large", {
    maxSize,
    actualSize: headerSize,
  });
}

export async function readBodyWithLimit(
  request: Request,
  maxSize: number = DEFAULT_LIMITS.maxBodySize,
): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) throw new ValidationError("No request body");

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

  const combined = new Uint8Array(totalSize);
  let offset = 0;

  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  return new TextDecoder().decode(combined);
}
