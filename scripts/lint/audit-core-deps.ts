import { walk } from "#std/fs";

export interface CoreDependencyIssue {
  specifier: string;
  target: string;
}

export interface CoreSourceDependencyIssue {
  path: string;
  line: number;
  specifier: string;
}

export interface RootNpmSpecifierLiteralIssue {
  path: string;
  value: string;
}

const CORE_THIRD_PARTY_IMPORT_ALLOWLIST = new Set<string>();

function isThirdPartyImportTarget(target: string): boolean {
  if (target.startsWith("./") || target.startsWith("../")) return false;
  if (target.startsWith("jsr:@std/")) return false;
  return target.startsWith("npm:") || target.startsWith("https://");
}

function importMapTargetForSpecifier(
  imports: Record<string, string>,
  specifier: string,
): string | undefined {
  const exact = imports[specifier];
  if (exact) return exact;

  let bestPrefix: string | undefined;
  for (const prefix of Object.keys(imports)) {
    if (!prefix.endsWith("/") || !specifier.startsWith(prefix)) continue;
    if (!bestPrefix || prefix.length > bestPrefix.length) bestPrefix = prefix;
  }
  if (!bestPrefix) return undefined;
  return `${imports[bestPrefix]}${specifier.slice(bestPrefix.length)}`;
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function shouldCheckCoreSourceImportPath(path: string): boolean {
  const normalized = normalizePath(path);
  if (!normalized.startsWith("src/") && !normalized.startsWith("cli/")) {
    return false;
  }
  if (normalized.startsWith("cli/templates/")) return false;
  if (
    normalized.includes("/__fixtures__/") || normalized.includes("/fixtures/")
  ) return false;
  if (normalized.endsWith("/_test-setup.ts")) return false;
  if (/\.(?:test|integration|e2e|bench)\.[cm]?[tj]sx?$/.test(normalized)) {
    return false;
  }
  return /\.(?:[cm]?ts|tsx)$/.test(normalized);
}

function isAllowedCoreSourceSpecifier(
  specifier: string,
  allowedSpecifiers: ReadonlySet<string>,
  importMap: Record<string, string>,
): boolean {
  if (
    specifier.startsWith("./") || specifier.startsWith("../") ||
    specifier.startsWith("/")
  ) {
    return true;
  }
  if (specifier.startsWith("#")) return true;
  if (specifier === "veryfront" || specifier.startsWith("veryfront/")) {
    return true;
  }
  if (specifier.startsWith("@veryfront/")) return true;
  if (specifier.startsWith("node:")) return true;
  if (specifier.startsWith("jsr:@std/")) return true;
  const mappedTarget = importMapTargetForSpecifier(importMap, specifier);
  if (mappedTarget && !isThirdPartyImportTarget(mappedTarget)) return true;
  return allowedSpecifiers.has(specifier);
}

const STATIC_IMPORT_EXPORT_START_RE = /^\s*(?:import|export)\b/;
const FROM_SPECIFIER_RE = /\bfrom\s+["']([^"']+)["']/;
const SIDE_EFFECT_IMPORT_RE = /^\s*import\s+["']([^"']+)["']/;
const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function readImportExportStatement(
  lines: string[],
  startIndex: number,
): string {
  let statement = lines[startIndex];
  for (let i = startIndex + 1; i < lines.length; i++) {
    if (statement.includes(";")) break;
    statement += `\n${lines[i]}`;
    if (
      FROM_SPECIFIER_RE.test(statement) || SIDE_EFFECT_IMPORT_RE.test(statement)
    ) break;
  }
  return statement;
}

function extractStaticSpecifier(statement: string): string | undefined {
  return FROM_SPECIFIER_RE.exec(statement)?.[1] ??
    SIDE_EFFECT_IMPORT_RE.exec(statement)?.[1];
}

function findMatchingDelimiter(
  source: string,
  start: number,
  opening: string,
  closing: string,
): number {
  let depth = 0;
  let quote: string | undefined;
  let escaped = false;
  for (let index = start; index < source.length; index++) {
    const character = source[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = undefined;
      }
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === opening) depth++;
    if (character === closing && --depth === 0) return index;
  }
  return -1;
}

function splitTopLevel(source: string, separator: string): string[] | undefined {
  const parts: string[] = [];
  let start = 0;
  let parentheses = 0;
  let brackets = 0;
  let braces = 0;
  let quote: string | undefined;
  let escaped = false;

  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = undefined;
      }
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "(") parentheses++;
    if (character === ")") parentheses--;
    if (character === "[") brackets++;
    if (character === "]") brackets--;
    if (character === "{") braces++;
    if (character === "}") braces--;
    if (parentheses < 0 || brackets < 0 || braces < 0) return undefined;
    if (
      character === separator && parentheses === 0 && brackets === 0 &&
      braces === 0
    ) {
      parts.push(source.slice(start, index));
      start = index + 1;
    }
  }
  if (quote || parentheses !== 0 || brackets !== 0 || braces !== 0) return undefined;
  parts.push(source.slice(start));
  return parts;
}

function decodeStringLiteral(expression: string): string | undefined {
  const quote = expression[0];
  if (
    expression.length < 2 || (quote !== '"' && quote !== "'" && quote !== "`") ||
    expression.at(-1) !== quote
  ) return undefined;
  const body = expression.slice(1, -1);
  if (quote === "`" && body.includes("${")) return undefined;

  let result = "";
  for (let index = 0; index < body.length; index++) {
    const character = body[index];
    if (character !== "\\") {
      if (character === quote) return undefined;
      result += character;
      continue;
    }
    const escaped = body[++index];
    if (escaped === undefined) return undefined;
    const simpleEscapes: Record<string, string> = {
      "0": "\0",
      b: "\b",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
      v: "\v",
    };
    if (escaped in simpleEscapes) {
      result += simpleEscapes[escaped];
      continue;
    }
    if (escaped === "x") {
      const digits = body.slice(index + 1, index + 3);
      if (!/^[0-9A-Fa-f]{2}$/.test(digits)) return undefined;
      result += String.fromCodePoint(Number.parseInt(digits, 16));
      index += 2;
      continue;
    }
    if (escaped === "u") {
      const braced = body[index + 1] === "{";
      const end = braced ? body.indexOf("}", index + 2) : index + 5;
      const digits = braced
        ? body.slice(index + 2, end)
        : body.slice(index + 1, end + 1);
      if (
        end < 0 || !/^[0-9A-Fa-f]+$/.test(digits) ||
        (!braced && digits.length !== 4)
      ) return undefined;
      const codePoint = Number.parseInt(digits, 16);
      if (codePoint > 0x10FFFF) return undefined;
      result += String.fromCodePoint(codePoint);
      index = end;
      continue;
    }
    if (escaped === "\n") continue;
    if (escaped === "\r") {
      if (body[index + 1] === "\n") index++;
      continue;
    }
    result += escaped;
  }
  return result;
}

function stripOuterParentheses(expression: string): string {
  let result = expression.trim();
  while (result.startsWith("(")) {
    const closing = findMatchingDelimiter(result, 0, "(", ")");
    if (closing !== result.length - 1) break;
    result = result.slice(1, -1).trim();
  }
  return result;
}

function evaluateStaticString(
  source: string,
  constants: ReadonlyMap<string, string>,
  depth = 0,
): string | undefined {
  if (depth > 16) return undefined;
  const expression = stripOuterParentheses(source);
  const literal = decodeStringLiteral(expression);
  if (literal !== undefined) return literal;
  if (IDENTIFIER_RE.test(expression)) return constants.get(expression);

  const additions = splitTopLevel(expression, "+");
  if (additions && additions.length > 1) {
    const values = additions.map((part) =>
      evaluateStaticString(part, constants, depth + 1)
    );
    if (values.every((value): value is string => value !== undefined)) {
      return values.join("");
    }
  }

  if (expression.startsWith("[")) {
    const arrayEnd = findMatchingDelimiter(expression, 0, "[", "]");
    if (arrayEnd > 0) {
      const suffix = expression.slice(arrayEnd + 1).trim();
      const joinMatch = /^\.join\s*\(([\s\S]*)\)$/.exec(suffix);
      if (joinMatch) {
        const separator = evaluateStaticString(joinMatch[1], constants, depth + 1);
        const entries = splitTopLevel(expression.slice(1, arrayEnd), ",");
        if (separator !== undefined && entries) {
          const values = entries.map((entry) =>
            evaluateStaticString(entry, constants, depth + 1)
          );
          if (values.every((value): value is string => value !== undefined)) {
            return values.join(separator);
          }
        }
      }
    }
  }
  return undefined;
}

function collectStaticStringConstants(content: string): Map<string, string> {
  const constants = new Map<string, string>();
  for (const line of content.split("\n")) {
    const declaration = /^\s*const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(.+?)\s*;?\s*$/.exec(
      line,
    );
    if (!declaration) continue;
    const value = evaluateStaticString(
      declaration[2].replace(/;\s*$/, ""),
      constants,
    );
    if (value !== undefined) constants.set(declaration[1], value);
  }
  return constants;
}

function findDynamicImportExpressions(
  content: string,
): Array<{ expression: string; line: number }> {
  const imports: Array<{ expression: string; line: number }> = [];
  let index = 0;
  let line = 1;

  while (index < content.length) {
    const character = content[index];
    if (character === "\n") {
      line++;
      index++;
      continue;
    }
    if (character === "/" && content[index + 1] === "/") {
      const nextLine = content.indexOf("\n", index + 2);
      if (nextLine < 0) break;
      index = nextLine;
      continue;
    }
    if (character === "/" && content[index + 1] === "*") {
      const end = content.indexOf("*/", index + 2);
      const stop = end < 0 ? content.length : end + 2;
      line += content.slice(index, stop).split("\n").length - 1;
      index = stop;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      const quote = character;
      index++;
      while (index < content.length) {
        if (content[index] === "\n") line++;
        if (content[index] === "\\") {
          index += 2;
          continue;
        }
        if (content[index++] === quote) break;
      }
      continue;
    }
    if (
      content.startsWith("import", index) &&
      !/[A-Za-z0-9_$]/.test(content[index - 1] ?? "") &&
      !/[A-Za-z0-9_$]/.test(content[index + 6] ?? "")
    ) {
      let opening = index + 6;
      while (/\s/.test(content[opening] ?? "")) opening++;
      if (content[opening] === "(") {
        const closing = findMatchingDelimiter(content, opening, "(", ")");
        if (closing > opening) {
          imports.push({
            expression: content.slice(opening + 1, closing),
            line,
          });
          line += content.slice(index, closing + 1).split("\n").length - 1;
          index = closing + 1;
          continue;
        }
      }
    }
    index++;
  }
  return imports;
}

export function findCoreThirdPartyImports(
  config: { imports?: Record<string, string> },
  options: { allowedSpecifiers?: ReadonlySet<string> } = {},
): CoreDependencyIssue[] {
  const allowedSpecifiers = options.allowedSpecifiers ??
    CORE_THIRD_PARTY_IMPORT_ALLOWLIST;
  const issues: CoreDependencyIssue[] = [];

  for (const [specifier, target] of Object.entries(config.imports ?? {})) {
    if (!isThirdPartyImportTarget(target)) continue;
    if (allowedSpecifiers.has(specifier)) continue;
    issues.push({ specifier, target });
  }

  return issues;
}

function formatJsonPathProperty(property: string): string {
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(property)) return `.${property}`;
  return `[${JSON.stringify(property)}]`;
}

function collectRootNpmSpecifierLiterals(
  value: unknown,
  path: string,
  issues: RootNpmSpecifierLiteralIssue[],
): void {
  if (typeof value === "string") {
    if (
      value.startsWith("npm:") &&
      !/^minimumDependencyAge\.exclude\[\d+\]$/.test(path)
    ) {
      issues.push({ path, value });
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      collectRootNpmSpecifierLiterals(entry, `${path}[${index}]`, issues)
    );
    return;
  }

  if (!value || typeof value !== "object") return;

  for (const [property, entry] of Object.entries(value)) {
    const nextPath = path
      ? `${path}${formatJsonPathProperty(property)}`
      : property;
    collectRootNpmSpecifierLiterals(entry, nextPath, issues);
  }
}

export function findRootNpmSpecifierLiterals(
  config: unknown,
): RootNpmSpecifierLiteralIssue[] {
  const issues: RootNpmSpecifierLiteralIssue[] = [];
  collectRootNpmSpecifierLiterals(config, "", issues);
  return issues;
}

export function findCoreThirdPartySourceImports(
  files: Array<{ path: string; content: string }>,
  options: {
    allowedSpecifiers?: ReadonlySet<string>;
    importMap?: Record<string, string>;
  } = {},
): CoreSourceDependencyIssue[] {
  const allowedSpecifiers = options.allowedSpecifiers ??
    CORE_THIRD_PARTY_IMPORT_ALLOWLIST;
  const importMap = options.importMap ?? {};
  const issues: CoreSourceDependencyIssue[] = [];

  for (const file of files) {
    const path = normalizePath(file.path);
    if (!shouldCheckCoreSourceImportPath(path)) continue;

    const lines = file.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (STATIC_IMPORT_EXPORT_START_RE.test(line)) {
        const specifier = extractStaticSpecifier(
          readImportExportStatement(lines, i),
        );
        if (
          specifier &&
          !isAllowedCoreSourceSpecifier(specifier, allowedSpecifiers, importMap)
        ) {
          issues.push({ path, line: i + 1, specifier });
        }
      }
    }

    const constants = collectStaticStringConstants(file.content);
    for (const dynamicImport of findDynamicImportExpressions(file.content)) {
      const dynamicSpecifier = evaluateStaticString(
        dynamicImport.expression,
        constants,
      );
      if (
        dynamicSpecifier &&
        !isAllowedCoreSourceSpecifier(
          dynamicSpecifier,
          allowedSpecifiers,
          importMap,
        )
      ) {
        issues.push({
          path,
          line: dynamicImport.line,
          specifier: dynamicSpecifier,
        });
      }
    }
  }

  return issues;
}

async function readCoreSourceFiles(): Promise<
  Array<{ path: string; content: string }>
> {
  const files: Array<{ path: string; content: string }> = [];

  for await (
    const entry of walk(".", {
      exts: [".ts", ".tsx", ".mts", ".cts"],
      skip: [
        /\bnode_modules\b/,
        /\bdist\b/,
        /\bcoverage\b/,
        /^\.\.?(?:\/|$)/,
        /^\.\/\.git(?:\/|$)/,
        /^\.\/\.omx(?:\/|$)/,
        /^\.\/\.worktrees(?:\/|$)/,
        /^\.\/npm(?:\/|$)/,
        /^\.\/projects(?:\/|$)/,
        /^\.\/data(?:\/|$)/,
        /^\.\/extensions(?:\/|$)/,
      ],
    })
  ) {
    if (!entry.isFile) continue;
    if (!shouldCheckCoreSourceImportPath(entry.path)) continue;
    files.push({
      path: normalizePath(entry.path),
      content: await Deno.readTextFile(entry.path),
    });
  }

  return files;
}

if (import.meta.main) {
  const config = JSON.parse(await Deno.readTextFile("deno.json"));
  const rootNpmLiteralIssues = findRootNpmSpecifierLiterals(config);
  const importMapIssues = findCoreThirdPartyImports(config);
  const sourceIssues = findCoreThirdPartySourceImports(
    await readCoreSourceFiles(),
    { importMap: config.imports ?? {} },
  );

  if (
    rootNpmLiteralIssues.length === 0 && importMapIssues.length === 0 &&
    sourceIssues.length === 0
  ) {
    console.log(
      "No disallowed third-party imports found in core deno.json or source files.",
    );
    Deno.exit(0);
  }

  if (rootNpmLiteralIssues.length > 0) {
    console.error(
      `${rootNpmLiteralIssues.length} npm specifier literal(s) in root deno.json:`,
    );
    for (const issue of rootNpmLiteralIssues) {
      console.error(`  ${issue.path}: ${issue.value}`);
    }
  }

  if (importMapIssues.length > 0) {
    console.error(
      `${importMapIssues.length} disallowed third-party import(s) in core deno.json:`,
    );
    for (const issue of importMapIssues) {
      console.error(`  ${issue.specifier}: ${issue.target}`);
    }
  }

  if (sourceIssues.length > 0) {
    console.error(
      `${sourceIssues.length} disallowed third-party import(s) in core source files:`,
    );
    for (const issue of sourceIssues) {
      console.error(`  ${issue.path}:${issue.line} imports ${issue.specifier}`);
    }
  }

  Deno.exit(1);
}
