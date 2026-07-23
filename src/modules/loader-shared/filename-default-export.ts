import { type JavaScriptSourceToken, tokenizeJavaScriptSource } from "./import-specifiers.ts";

const IDENTIFIER_PATTERN = /^[A-Za-z_$][\w$]*$/;

interface ExportMatch {
  localName: string;
  sourceClause: string;
}

function getModuleIdentifier(normalizedPath: string): string | null {
  const fileName = normalizedPath.replace(/\?.*$/, "").split("/").pop();
  const identifier = fileName?.replace(/\.(?:[cm]?[jt]sx?|mdx)$/i, "");
  if (!identifier || !IDENTIFIER_PATTERN.test(identifier)) return null;
  return identifier;
}

function splitExportSpecifiers(
  tokens: JavaScriptSourceToken[],
  start: number,
): { end: number; specifiers: JavaScriptSourceToken[][] } | null {
  const specifiers: JavaScriptSourceToken[][] = [];
  let current: JavaScriptSourceToken[] = [];
  let depth = 1;

  for (let index = start; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (token.value === "{") {
      depth++;
      current.push(token);
      continue;
    }
    if (token.value === "}") {
      depth--;
      if (depth === 0) {
        if (current.length > 0) specifiers.push(current);
        return { end: index, specifiers };
      }
      current.push(token);
      continue;
    }
    if (token.value === "," && depth === 1) {
      if (current.length > 0) specifiers.push(current);
      current = [];
      continue;
    }
    current.push(token);
  }

  return null;
}

function getExportedName(specifier: JavaScriptSourceToken[]): {
  localName: string;
  exportedName: string;
} | null {
  const meaningful = specifier.filter((token) =>
    token.type === "identifier" || token.type === "string"
  );
  if (meaningful[0]?.value === "type") meaningful.shift();
  const asIndex = meaningful.findIndex((token) => token.value === "as");
  if (asIndex === -1) {
    const name = meaningful[0]?.value;
    return name ? { localName: name, exportedName: name } : null;
  }

  const localName = meaningful[asIndex - 1]?.value;
  const exportedName = meaningful[asIndex + 1]?.value;
  return localName && exportedName ? { localName, exportedName } : null;
}

function getSourceClause(
  moduleCode: string,
  tokens: JavaScriptSourceToken[],
  closingBraceIndex: number,
): string {
  const fromToken = tokens[closingBraceIndex + 1];
  const sourceToken = tokens[closingBraceIndex + 2];
  if (fromToken?.value !== "from" || sourceToken?.type !== "string") return "";
  return " " + moduleCode.slice(fromToken.start, sourceToken.end + 1);
}

function inspectExports(moduleCode: string, exportName: string): {
  hasDefault: boolean;
  match: ExportMatch | null;
} {
  const tokens = tokenizeJavaScriptSource(moduleCode);
  let match: ExportMatch | null = null;

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (
      token?.type !== "identifier" || token.value !== "export" ||
      tokens[index - 1]?.value === "."
    ) {
      continue;
    }

    let nextIndex = index + 1;
    if (tokens[nextIndex]?.value === "default") {
      return { hasDefault: true, match };
    }
    if (tokens[nextIndex]?.value === "type") continue;
    if (
      tokens[nextIndex]?.value === "*" &&
      tokens[nextIndex + 1]?.value === "as" &&
      tokens[nextIndex + 2]?.value === "default"
    ) {
      return { hasDefault: true, match };
    }
    if (tokens[nextIndex]?.value === "async") nextIndex++;

    const declarationKind = tokens[nextIndex]?.value;
    if (
      declarationKind === "const" || declarationKind === "let" ||
      declarationKind === "var" || declarationKind === "function" ||
      declarationKind === "class"
    ) {
      let nameIndex = nextIndex + 1;
      if (declarationKind === "function" && tokens[nameIndex]?.value === "*") nameIndex++;
      if (tokens[nameIndex]?.value === exportName && match === null) {
        match = { localName: exportName, sourceClause: "" };
      }
      continue;
    }

    if (tokens[nextIndex]?.value !== "{") continue;
    const list = splitExportSpecifiers(tokens, nextIndex + 1);
    if (!list) continue;
    const sourceClause = getSourceClause(moduleCode, tokens, list.end);
    for (const specifier of list.specifiers) {
      const names = getExportedName(specifier);
      if (!names) continue;
      if (names.exportedName === "default") return { hasDefault: true, match };
      if (names.exportedName === exportName && match === null) {
        match = { localName: names.localName, sourceClause };
      }
    }
    index = list.end;
  }

  return { hasDefault: false, match };
}

function appendExportBeforeSourceMap(moduleCode: string, exportStatement: string): string {
  const sourceMapMarker = "//# sourceMappingURL=";
  let sourceMapIndex = moduleCode.lastIndexOf("\n" + sourceMapMarker);
  if (sourceMapIndex < 0 && moduleCode.startsWith(sourceMapMarker)) {
    sourceMapIndex = 0;
  }

  if (sourceMapIndex < 0) {
    return moduleCode.trimEnd() + "\n" + exportStatement + "\n";
  }

  const beforeSourceMap = moduleCode.slice(0, sourceMapIndex).trimEnd();
  const sourceMap = moduleCode.slice(sourceMapIndex);
  const terminatedSourceMap = sourceMap.endsWith("\n") ? sourceMap : sourceMap + "\n";
  return beforeSourceMap + "\n" + exportStatement + terminatedSourceMap;
}

export function ensureFilenameDefaultExport(normalizedPath: string, moduleCode: string): string {
  const exportName = getModuleIdentifier(normalizedPath);
  if (!exportName) return moduleCode;

  const inspected = inspectExports(moduleCode, exportName);
  if (inspected.hasDefault || !inspected.match) return moduleCode;

  return appendExportBeforeSourceMap(
    moduleCode,
    "export { " + inspected.match.localName + " as default }" +
      inspected.match.sourceClause + ";",
  );
}
