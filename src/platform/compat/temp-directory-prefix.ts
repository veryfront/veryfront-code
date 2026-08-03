/**
 * Validate a prefix before combining it with an operating-system temp root.
 *
 * Prefixes are file-name fragments, not paths. Rejecting separators and null
 * bytes keeps every runtime adapter beneath its selected temp root.
 */
export function validateTempDirectoryPrefix(prefix: unknown): string {
  if (typeof prefix !== "string") {
    throw new TypeError("Temporary directory prefix must be a string");
  }
  if (prefix.includes("/") || prefix.includes("\\") || prefix.includes("\0")) {
    throw new TypeError(
      "Temporary directory prefix must not contain path separators or null bytes",
    );
  }
  return prefix;
}
