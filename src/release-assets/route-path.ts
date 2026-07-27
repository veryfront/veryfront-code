import { hasControlCharacters } from "./string-validation.ts";
import { RELEASE_ASSET_MANIFEST_LIMITS } from "./constants.ts";

/** Derive a route path from a page module logical path. */
export function routeForPage(logicalPath: string): string | null {
  if (
    typeof logicalPath !== "string" ||
    logicalPath.length > RELEASE_ASSET_MANIFEST_LIMITS.manifestKeyLength ||
    !logicalPath.startsWith("pages/") ||
    logicalPath.includes("\\") ||
    logicalPath.includes("?") ||
    logicalPath.includes("#") ||
    hasControlCharacters(logicalPath) ||
    !/\.(?:tsx?|jsx?|mdx)$/.test(logicalPath)
  ) {
    return null;
  }
  const parts = logicalPath.split("/");
  if (parts.some((part) => part.length === 0 || part === "." || part === "..")) {
    return null;
  }
  const withoutPrefix = logicalPath.slice("pages/".length);
  const withoutExt = withoutPrefix.replace(/\.(tsx|ts|jsx|mdx|js)$/, "");
  const route = withoutExt.replace(/\/index$/, "").replace(/^index$/, "");
  return `/${route}`.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}
