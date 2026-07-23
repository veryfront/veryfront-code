import { readResponseTextPrefix } from "#veryfront/utils/response-body.ts";

/** Maximum accepted source size for a fetched JavaScript or MDX module. */
export const MAX_HTTP_MODULE_RESPONSE_BYTES = 8 * 1024 * 1024;

const textEncoder = new TextEncoder();

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Cancellation is best effort. The size rejection remains authoritative.
  }
}

/**
 * Read a fetched module without allowing an unbounded response body.
 *
 * Returns null when the declared or observed body exceeds the module limit.
 */
export async function readHttpModuleResponse(response: Response): Promise<string | null> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const declaredBytes = Number(contentLength);
    if (Number.isFinite(declaredBytes) && declaredBytes > MAX_HTTP_MODULE_RESPONSE_BYTES) {
      await cancelResponseBody(response);
      return null;
    }
  }

  const { text, truncated } = await readResponseTextPrefix(
    response,
    MAX_HTTP_MODULE_RESPONSE_BYTES + 1,
  );
  if (
    truncated ||
    textEncoder.encode(text).byteLength > MAX_HTTP_MODULE_RESPONSE_BYTES
  ) {
    return null;
  }

  return text;
}
