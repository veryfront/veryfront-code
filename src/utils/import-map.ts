export type ImportMapImports = Record<string, string>;

/**
 * Browser-resolved bare specifiers that Veryfront keeps in the output bundle.
 * Empty-string values are intentional sentinels: ownership matters, not truthiness.
 */
export const DEFAULT_BROWSER_IMPORT_MAP_IMPORTS: Readonly<ImportMapImports> = Object.freeze({
  react: "",
  "react-dom": "",
  "react-dom/client": "",
  "react-dom/server": "",
  "react/jsx-runtime": "",
  "react/jsx-dev-runtime": "",
});

export function mergeBrowserImportMapImports(
  imports?: ImportMapImports,
): ImportMapImports {
  return {
    ...DEFAULT_BROWSER_IMPORT_MAP_IMPORTS,
    ...(imports ?? {}),
  };
}

export function importMapOwnsSpecifier(
  specifier: string,
  imports?: ImportMapImports,
): boolean {
  if (!imports) return false;
  if (Object.prototype.hasOwnProperty.call(imports, specifier)) return true;

  for (const key of Object.keys(imports)) {
    if (key.endsWith("/") && specifier.startsWith(key)) return true;
  }

  return false;
}

export function parseImportMapImports(json: string): ImportMapImports {
  try {
    const parsed = JSON.parse(json) as { imports?: ImportMapImports } | null;
    return parsed?.imports ?? {};
  } catch (error) {
    // A malformed import map silently flips the RSC client-module strategy.
    // This module is browser-bundled, so the server logger (which pulls in
    // node:async_hooks) is unavailable; console.warn keeps the failure diagnosable.
    console.warn("Failed to parse import map JSON; treating as empty", {
      error: error instanceof Error ? error.message : String(error),
      preview: json.slice(0, 200),
    });
    return {};
  }
}

export function getDocumentImportMapImports(doc: Document = document): ImportMapImports {
  const importMapElement = doc.querySelector('script[type="importmap"]');
  if (!importMapElement?.textContent) return {};

  return parseImportMapImports(importMapElement.textContent);
}
