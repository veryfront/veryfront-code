import { isAbsolute } from "#veryfront/compat/path/index.ts";
import { MAX_PATH_LENGTH_CHARS } from "#veryfront/utils/constants/limits.ts";
import { hasControlCharacters } from "../../utils/string-validation.ts";

/** Return whether a path is a normalized, portable project-relative CSS path. */
export function isSafeCSSRelativePath(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_PATH_LENGTH_CHARS ||
    value !== value.normalize("NFC") ||
    hasControlCharacters(value) ||
    isAbsolute(value) ||
    value.startsWith("/") ||
    value.startsWith("\\") ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.includes("\\")
  ) {
    return false;
  }

  return !value.split("/").some((segment) =>
    segment.length === 0 || segment === "." || segment === ".."
  );
}
