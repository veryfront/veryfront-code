import { ValidationError } from "./errors.js";
import { DEFAULT_LIMITS } from "./types.js";
export function validateRequestLimits(request, limits = {}) {
    const config = { ...DEFAULT_LIMITS, ...limits };
    validateUrlLength(request.url, config.maxUrlLength);
    validateContentLength(request, config.maxBodySize);
    validateHeaderSize(request, config.maxHeaderSize);
}
function validateUrlLength(url, maxLength) {
    if (url.length <= maxLength)
        return;
    throw new ValidationError("URL too long", {
        maxLength,
        actualLength: url.length,
    });
}
function validateContentLength(request, maxSize) {
    const contentLength = request.headers.get("content-length");
    if (!contentLength)
        return;
    const size = Number.parseInt(contentLength, 10);
    if (Number.isNaN(size)) {
        throw new ValidationError("Invalid Content-Length header");
    }
    if (size <= maxSize)
        return;
    throw new ValidationError("Request body too large", {
        maxSize,
        actualSize: size,
    });
}
function validateHeaderSize(request, maxSize) {
    let headerSize = 0;
    for (const [key, value] of request.headers) {
        headerSize += key.length + value.length + 4; // ": " and "\r\n"
    }
    if (headerSize <= maxSize)
        return;
    throw new ValidationError("Headers too large", {
        maxSize,
        actualSize: headerSize,
    });
}
export async function readBodyWithLimit(request, maxSize = DEFAULT_LIMITS.maxBodySize) {
    const reader = request.body?.getReader();
    if (!reader)
        throw new ValidationError("No request body");
    const chunks = [];
    let totalSize = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            totalSize += value.length;
            if (totalSize > maxSize) {
                throw new ValidationError("Request body exceeds size limit", {
                    maxSize,
                    bytesRead: totalSize,
                });
            }
            chunks.push(value);
        }
    }
    finally {
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
