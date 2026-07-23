const MODULE_PATH_PREFIXES = ["/_vf_modules/", "/_veryfront/modules/"] as const;
const EMBEDDED_FRAMEWORK_MODULES = new Set([
  "_dnt.shims",
  "_dnt.polyfills",
  "_deno-config",
  "deno",
]);

function stripKnownModuleExtension(path: string): string {
  return path.replace(/\.(?:json|tsx?|jsx?|mdx?)(?:\.src)?$/, "");
}

/** Return whether a module path belongs to the embedded framework runtime. */
export function isFrameworkOwnedModulePath(pathname: string): boolean {
  const prefix = MODULE_PATH_PREFIXES.find((candidate) => pathname.startsWith(candidate));
  if (!prefix) return false;

  let modulePath: string;
  try {
    modulePath = decodeURIComponent(pathname.slice(prefix.length));
  } catch {
    return false;
  }

  if (!modulePath || modulePath.includes("\\") || modulePath.includes("%")) return false;
  const segments = modulePath.split("/");
  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    return false;
  }

  const normalized = stripKnownModuleExtension(modulePath);
  return normalized.startsWith("_veryfront/") || normalized.startsWith("react/") ||
    normalized.startsWith("deps/") || EMBEDDED_FRAMEWORK_MODULES.has(normalized);
}

/** Build the terminal response for the removed legacy module endpoint. */
export function createDeprecatedModuleResponse(req: Request): Response {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  const body = req.method.toUpperCase() === "HEAD"
    ? null
    : JSON.stringify({ error: "This module endpoint is no longer available" });
  return new Response(body, { status: 410, headers });
}
