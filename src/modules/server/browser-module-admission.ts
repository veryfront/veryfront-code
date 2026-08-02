import type { VeryfrontConfig } from "#veryfront/config";

const PROJECT_METADATA_FILE =
  /^(?:veryfront\.config\.(?:ts|js|mjs)|deno\.jsonc?|import_map\.json|package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|veryfront\.lock|tsconfig(?:\.[a-z0-9_-]+)?\.json|\.env(?:\..+)?)$/i;

function canonicalProjectRoot(value: unknown, fallback: string): string {
  if (typeof value !== "string" || value.length === 0 || value.includes("\\")) return fallback;
  const parts = value.split("/").filter((part) => part.length > 0 && part !== ".");
  if (parts.some((part) => part === "..")) return fallback;
  return parts.join("/");
}

function belowRoot(root: string, child: string): string {
  return root ? `${root}/${child}` : child;
}

function isAtOrBelow(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

/**
 * Framework-owned project surfaces that are never browser module entrypoints.
 *
 * This is a narrow invariant, not a replacement for the release manifest:
 * project metadata and server route/action roots remain private even when a
 * legacy deployment has not enabled manifest-backed browser admission yet.
 */
export function isProtectedBrowserModulePath(
  logicalPath: string,
  config?: VeryfrontConfig,
): boolean {
  const path = logicalPath.replace(/^\/+/, "").replace(/[?#].*$/, "");
  if (!path || path.includes("\\") || path.split("/").some((part) => part === "..")) return true;

  const parts = path.split("/");
  const metadataCandidate = parts.length === 1 ? parts[0]!.replace(/\.(?:mjs|js)$/i, "") : "";
  if (
    parts.length === 1 &&
    (PROJECT_METADATA_FILE.test(parts[0]!) || PROJECT_METADATA_FILE.test(metadataCandidate))
  ) {
    return true;
  }
  if (parts.some((part) => part.startsWith("."))) return true;

  const appRoot = canonicalProjectRoot(config?.directories?.app, "app");
  const pagesRoot = canonicalProjectRoot(config?.directories?.pages, "pages");
  return isAtOrBelow(path, belowRoot(appRoot, "actions")) ||
    isAtOrBelow(path, belowRoot(appRoot, "api")) ||
    isAtOrBelow(path, belowRoot(pagesRoot, "api")) ||
    isAtOrBelow(path, "api");
}
