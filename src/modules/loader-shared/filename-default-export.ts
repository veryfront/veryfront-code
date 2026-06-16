const IDENTIFIER_PATTERN = /^[A-Za-z_$][\w$]*$/;
const DEFAULT_EXPORT_PATTERN = /\bexport\s+default\b|\bexport\s*\{[^}]*\bas\s+default\b[^}]*\}/;

interface ExportMatch {
  localName: string;
  sourceClause: string;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getModuleIdentifier(normalizedPath: string): string | null {
  const fileName = normalizedPath.replace(/\?.*$/, "").split("/").pop();
  const identifier = fileName?.replace(/\.(?:[cm]?[jt]sx?|mdx)$/i, "");
  if (!identifier || !IDENTIFIER_PATTERN.test(identifier)) return null;
  return identifier;
}

function findExportMatch(moduleCode: string, exportName: string): ExportMatch | null {
  const declarationPattern = new RegExp(
    `\\bexport\\s+(?:const|let|var|function|class)\\s+${escapeRegex(exportName)}\\b`,
  );
  if (declarationPattern.test(moduleCode)) return { localName: exportName, sourceClause: "" };

  const exportListPattern = /\bexport\s*\{([^}]*)\}\s*(from\s*["'][^"']+["'])?\s*(?:;|$)/gm;
  let match: RegExpExecArray | null;
  while ((match = exportListPattern.exec(moduleCode)) !== null) {
    const specifiers = match[1]?.split(",") ?? [];
    const sourceClause = match[2] ? ` ${match[2]}` : "";
    for (const rawSpecifier of specifiers) {
      const specifier = rawSpecifier.trim();
      if (specifier === exportName) return { localName: exportName, sourceClause };

      const alias = specifier.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
      if (alias?.[2] === exportName && alias[1]) {
        return { localName: alias[1], sourceClause };
      }
    }
  }

  return null;
}

function appendExportBeforeSourceMap(moduleCode: string, exportStatement: string): string {
  const sourceMapMarker = "//# sourceMappingURL=";
  let sourceMapIndex = moduleCode.lastIndexOf(`\n${sourceMapMarker}`);
  if (sourceMapIndex < 0 && moduleCode.startsWith(sourceMapMarker)) {
    sourceMapIndex = 0;
  }

  if (sourceMapIndex < 0) {
    return `${moduleCode.trimEnd()}\n${exportStatement}\n`;
  }

  const beforeSourceMap = moduleCode.slice(0, sourceMapIndex).trimEnd();
  const sourceMap = moduleCode.slice(sourceMapIndex);
  return `${beforeSourceMap}\n${exportStatement}${
    sourceMap.endsWith("\n") ? sourceMap : `${sourceMap}\n`
  }`;
}

export function ensureFilenameDefaultExport(normalizedPath: string, moduleCode: string): string {
  if (DEFAULT_EXPORT_PATTERN.test(moduleCode)) return moduleCode;

  const exportName = getModuleIdentifier(normalizedPath);
  if (!exportName) return moduleCode;

  const exportMatch = findExportMatch(moduleCode, exportName);
  if (!exportMatch) return moduleCode;

  return appendExportBeforeSourceMap(
    moduleCode,
    `export { ${exportMatch.localName} as default }${exportMatch.sourceClause};`,
  );
}
