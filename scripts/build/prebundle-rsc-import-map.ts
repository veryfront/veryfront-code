import { join } from "#std/path.ts";

export const RSC_BROWSER_ERROR_REGISTRY_PATH =
  "./src/rendering/client/browser-stubs/error-registry.ts";

function resolveBrowserOverride(specifier: string): string | null {
  switch (specifier) {
    case "#veryfront/errors":
    case "#veryfront/errors/error-registry.ts":
    case "#veryfront/errors/error-registry/general.ts":
      return RSC_BROWSER_ERROR_REGISTRY_PATH;
    default:
      return null;
  }
}

export function resolveRscImportMapSpecifier(
  specifier: string,
  projectRoot: string,
  importMap: Readonly<Record<string, string>>,
): string | null {
  // Browser entries must never cross into the server error graph. Both forms
  // are public import-map spellings used by client-side modules.
  const browserOverride = resolveBrowserOverride(specifier);
  if (browserOverride) return join(projectRoot, browserOverride);

  const exactTarget = importMap[specifier];
  if (exactTarget) {
    return exactTarget.startsWith("./") ? join(projectRoot, exactTarget) : null;
  }

  let bestKey = "";
  let bestTarget = "";
  for (const [key, value] of Object.entries(importMap)) {
    if (!key.endsWith("/") || !specifier.startsWith(key)) continue;
    if (key.length > bestKey.length) {
      bestKey = key;
      bestTarget = value;
    }
  }

  if (!bestKey || !bestTarget.startsWith("./")) return null;
  return join(projectRoot, bestTarget, specifier.slice(bestKey.length));
}
