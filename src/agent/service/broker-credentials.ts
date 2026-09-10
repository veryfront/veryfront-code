const MAX_URI_DECODE_PASSES = 16;
const uriTextDecoder = new TextDecoder();

/** Reject known credentials or text that exceeds the URI normalization limit. */
export function containsBrokerCredential(
  value: unknown,
  credentials: readonly (string | null | undefined)[],
): boolean {
  for (const credential of credentials) {
    if (!credential) continue;
    if (containsString(value, credential)) return true;
    const bearer = /^Bearer\s+(.+)$/i.exec(credential)?.[1];
    if (bearer && containsString(value, bearer)) return true;
  }
  return false;
}

function containsString(value: unknown, expected: string): boolean {
  if (typeof value === "string") return containsCredentialText(value, expected);
  if (!value || typeof value !== "object") return false;
  return Array.isArray(value)
    ? value.some((entry) => containsString(entry, expected))
    : Object.entries(value).some(([key, entry]) =>
      containsCredentialText(key, expected) || containsString(entry, expected)
    );
}

function containsCredentialText(value: string, expected: string): boolean {
  let text = value;
  for (let pass = 0; pass < MAX_URI_DECODE_PASSES; pass++) {
    if (text.includes(expected)) return true;
    if (!/%[0-9a-f]{2}/i.test(text)) return false;
    // Decode valid byte runs independently. A malformed escape or invalid
    // UTF-8 prefix must not hide a valid credential later in the same string.
    text = text.replace(/(?:%[0-9a-f]{2})+/gi, (encoded) => {
      const bytes = new Uint8Array(encoded.length / 3);
      for (let index = 0; index < bytes.length; index++) {
        bytes[index] = Number.parseInt(encoded.slice(index * 3 + 1, index * 3 + 3), 16);
      }
      return uriTextDecoder.decode(bytes);
    });
  }
  // Keep normalization work bounded and reject text that needs more decoding.
  return text.includes(expected) || /%[0-9a-f]{2}/i.test(text);
}
