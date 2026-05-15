import { walk } from "jsr:@std/fs";

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
const DYNAMIC_IMPORT_RE = /(^|[^"'`])\bimport\s*\(\s*["']([^"']+)["']\s*\)/;

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
    if (value.startsWith("npm:")) {
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

      const dynamicSpecifier = DYNAMIC_IMPORT_RE.exec(line)?.[2];
      if (
        dynamicSpecifier &&
        !isAllowedCoreSourceSpecifier(
          dynamicSpecifier,
          allowedSpecifiers,
          importMap,
        )
      ) {
        issues.push({ path, line: i + 1, specifier: dynamicSpecifier });
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
