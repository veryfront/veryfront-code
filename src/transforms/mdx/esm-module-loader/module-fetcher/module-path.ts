import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";

const MAX_MODULE_PATH_LENGTH = 8_192;

/** Reject module paths that can escape or ambiguously address the virtual module root. */
export function assertSafeNormalizedModulePath(modulePath: string): void {
  const path = modulePath.replace(/\?.*$/, "");
  const segments = path.split("/");
  if (
    modulePath.length === 0 || modulePath.length > MAX_MODULE_PATH_LENGTH ||
    path.includes("\\") || path.includes("%") ||
    hasUnsafeControlCharacters(path) ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new TypeError("Module path must stay inside the virtual module root");
  }
}
