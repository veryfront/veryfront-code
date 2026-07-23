import { RELEASE_ASSET_MANIFEST_KEY_MAX_BYTES } from "./constants.ts";

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

/** Derive a route path from a page module logical path. */
export function routeForPage(logicalPath: string): string | null {
  if (
    typeof logicalPath !== "string" || logicalPath.length === 0 ||
    logicalPath.length > RELEASE_ASSET_MANIFEST_KEY_MAX_BYTES ||
    !logicalPath.startsWith("pages/") || logicalPath.includes("\\") ||
    hasControlCharacter(logicalPath) ||
    ["%", "?", "#"].some((value) => logicalPath.includes(value)) || logicalPath.endsWith(".d.ts") ||
    !/\.(?:tsx|ts|jsx|mdx|js)$/.test(logicalPath)
  ) {
    return null;
  }
  const withoutPrefix = logicalPath.slice("pages/".length);
  const segments = withoutPrefix.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null;

  const withoutExt = withoutPrefix.replace(/\.(tsx|ts|jsx|mdx|js)$/, "");
  const route = withoutExt.replace(/\/index$/, "").replace(/^index$/, "");
  return `/${route}`.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
}
