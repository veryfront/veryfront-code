/** Detect known broker credentials in bounded application strings and property names. */
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
  if (typeof value === "string") return value.includes(expected);
  if (!value || typeof value !== "object") return false;
  return Array.isArray(value)
    ? value.some((entry) => containsString(entry, expected))
    : Object.entries(value).some(([key, entry]) =>
      key.includes(expected) || containsString(entry, expected)
    );
}
