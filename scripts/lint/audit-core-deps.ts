import { walk } from "#std/fs";
import { join } from "#std/path";
import { collectSourceDependencies } from "./source-import-collector.ts";

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

export interface CoreDependencyConfigScope {
  path: string;
  root: string;
  config: Record<string, unknown> & { imports?: Record<string, string> };
}

export interface ScopedCoreImportMap {
  root: string;
  imports: Record<string, string>;
}

const CORE_THIRD_PARTY_IMPORT_ALLOWLIST = new Set<string>();
const CORE_SOURCE_ROOT_URL = new URL("file:///veryfront-repository/");
const CORE_DEPENDENCY_CONFIG_SCOPES = [
  { path: "deno.json", root: "" },
  { path: "cli/deno.json", root: "cli/" },
] as const;

function isThirdPartyImportTarget(target: string): boolean {
  if (target.startsWith("./") || target.startsWith("../")) return false;
  if (target.startsWith("#")) return false;
  if (target === "veryfront" || target.startsWith("veryfront/")) return false;
  if (target.startsWith("@veryfront/")) return false;
  if (target.startsWith("node:")) return false;
  if (target.startsWith("jsr:@std/")) return false;
  return true;
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

function importMapForSourcePath(
  path: string,
  rootImportMap: Record<string, string>,
  scopedImportMaps: readonly ScopedCoreImportMap[],
): Record<string, string> {
  const applicable = scopedImportMaps
    .map(({ root, imports }) => ({
      root: normalizePath(root).replace(/\/?$/, "/"),
      imports,
    }))
    .filter(({ root }) => path.startsWith(root))
    .sort((left, right) => left.root.length - right.root.length);
  return Object.assign(
    {},
    rootImportMap,
    ...applicable.map(({ imports }) => imports),
  );
}

function bypassesFirstPartyExtensionPackageBoundary(
  sourcePath: string,
  specifier: string,
): boolean {
  if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
    return false;
  }

  const sourceUrl = new URL(sourcePath, CORE_SOURCE_ROOT_URL);
  const targetUrl = new URL(specifier, sourceUrl);
  const target = targetUrl.pathname.startsWith(CORE_SOURCE_ROOT_URL.pathname)
    ? targetUrl.pathname.slice(CORE_SOURCE_ROOT_URL.pathname.length)
    : "";
  return target === "extensions" || target.startsWith("extensions/");
}

export function shouldCheckCoreSourceImportPath(path: string): boolean {
  const normalized = normalizePath(path);
  if (!normalized.startsWith("src/") && !normalized.startsWith("cli/")) {
    return false;
  }
  if (normalized.startsWith("cli/templates/")) return false;
  if (
    normalized.includes("/__fixtures__/") ||
    normalized.includes("/fixtures/") ||
    normalized.includes("/__tests__/")
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
    scopedImportMaps?: readonly ScopedCoreImportMap[];
  } = {},
): CoreSourceDependencyIssue[] {
  const allowedSpecifiers = options.allowedSpecifiers ??
    CORE_THIRD_PARTY_IMPORT_ALLOWLIST;
  const importMap = options.importMap ?? {};
  const issues: CoreSourceDependencyIssue[] = [];

  for (const file of files) {
    const path = normalizePath(file.path);
    if (!shouldCheckCoreSourceImportPath(path)) continue;
    const applicableImportMap = importMapForSourcePath(
      path,
      importMap,
      options.scopedImportMaps ?? [],
    );

    for (
      const dependency of collectSourceDependencies({
        path,
        content: file.content,
      })
    ) {
      const specifier = dependency.specifier;
      if (
        specifier &&
        (bypassesFirstPartyExtensionPackageBoundary(path, specifier) ||
          !isAllowedCoreSourceSpecifier(
            specifier,
            allowedSpecifiers,
            applicableImportMap,
          ))
      ) {
        issues.push({ path, line: dependency.line, specifier });
      }
    }
  }

  return issues;
}

export async function readCoreSourceFiles(): Promise<
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
        /^\.\.(?:\/|$)/,
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

export async function readCoreDependencyConfigs(
  root = ".",
): Promise<CoreDependencyConfigScope[]> {
  return await Promise.all(
    CORE_DEPENDENCY_CONFIG_SCOPES.map(async ({ path, root: scopeRoot }) => ({
      path,
      root: scopeRoot,
      config: JSON.parse(
        await Deno.readTextFile(join(root, path)),
      ) as CoreDependencyConfigScope["config"],
    })),
  );
}

if (import.meta.main) {
  const configs = await readCoreDependencyConfigs();
  const rootConfig = configs.find(({ root }) => root === "");
  if (!rootConfig) {
    throw new Error("Core dependency audit is missing deno.json");
  }
  const npmLiteralIssues = configs.flatMap(({ path, config }) =>
    findRootNpmSpecifierLiterals(config).map((issue) => ({
      configPath: path,
      ...issue,
    }))
  );
  const importMapIssues = configs.flatMap(({ path, config }) =>
    findCoreThirdPartyImports(config).map((issue) => ({
      configPath: path,
      ...issue,
    }))
  );
  const sourceIssues = findCoreThirdPartySourceImports(
    await readCoreSourceFiles(),
    {
      importMap: rootConfig.config.imports ?? {},
      scopedImportMaps: configs
        .filter(({ root }) => root !== "")
        .map(({ root, config }) => ({
          root,
          imports: config.imports ?? {},
        })),
    },
  );

  if (
    npmLiteralIssues.length === 0 && importMapIssues.length === 0 &&
    sourceIssues.length === 0
  ) {
    console.log(
      "No disallowed third-party imports found in core configuration or source files.",
    );
    Deno.exit(0);
  }

  if (npmLiteralIssues.length > 0) {
    console.error(
      `${npmLiteralIssues.length} npm specifier literal(s) in core configuration:`,
    );
    for (const issue of npmLiteralIssues) {
      console.error(`  ${issue.configPath}:${issue.path}: ${issue.value}`);
    }
  }

  if (importMapIssues.length > 0) {
    console.error(
      `${importMapIssues.length} disallowed third-party import(s) in core configuration:`,
    );
    for (const issue of importMapIssues) {
      console.error(
        `  ${issue.configPath}:${issue.specifier}: ${issue.target}`,
      );
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
