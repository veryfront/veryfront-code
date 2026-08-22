import { walk } from "#std/fs/walk";
import {
  LEAF_TEST_SUITES,
  type LeafTestSuite,
  type ResolvedLeafSuiteOwner,
  resolveLeafSuiteOwners,
  validateLeafSuiteRegistry,
} from "./suites.ts";
import {
  TEST_LAYOUT_MIGRATION_ENTRIES,
  type TestLayoutMigrationEntry,
} from "./test-layout-migration.ts";

export type ExecutableTestKind = "deno" | "playwright";

export type TestLayoutClassification =
  & {
    readonly path: string;
    readonly level: ResolvedLeafSuiteOwner["level"];
    readonly suite: ResolvedLeafSuiteOwner["suite"];
    readonly runner: ResolvedLeafSuiteOwner["runner"];
    readonly variant?: ResolvedLeafSuiteOwner["variant"];
  }
  & (
    | { readonly kind: "canonical" }
    | { readonly kind: "migration"; readonly migrationEntry: string }
  );

export interface ValidateTestLayoutOptions {
  readonly root?: string;
  readonly suites?: readonly LeafTestSuite[];
  readonly migrationEntries?: readonly TestLayoutMigrationEntry[];
}

export interface TestLayoutValidationResult {
  readonly files: number;
  readonly canonical: number;
  readonly migration: number;
  readonly timingMs: number;
  readonly errors: string[];
}

const EXECUTABLE_TEST_PATTERN = /\.(?:test|playwright)\.(?:ts|tsx|js|mjs|cjs)$/;
const PLAYWRIGHT_TEST_PATTERN = /\.playwright\.(?:ts|tsx|js|mjs|cjs)$/;
const IGNORED_ROOTS = new Set([
  ".git",
  ".deno_cache",
  "coverage",
  "dist",
  "node_modules",
  "npm",
]);

export function getExecutableTestKind(
  path: string,
): ExecutableTestKind | undefined {
  const normalized = normalizeProjectPath(path);
  if (!EXECUTABLE_TEST_PATTERN.test(normalized)) return undefined;
  return PLAYWRIGHT_TEST_PATTERN.test(normalized) ? "playwright" : "deno";
}

export function classifyTestPath(
  path: string,
  options: Omit<ValidateTestLayoutOptions, "root"> = {},
): TestLayoutClassification {
  const normalized = normalizeProjectPath(path);
  const executableKind = getExecutableTestKind(normalized);
  if (!executableKind) {
    throw new Error(`Unsupported or non-executable test path: ${normalized}`);
  }

  const suites = options.suites ?? LEAF_TEST_SUITES;
  const migrationEntries = options.migrationEntries ??
    TEST_LAYOUT_MIGRATION_ENTRIES;
  const canonicalOwners = resolveLeafSuiteOwners(normalized, suites);
  if (canonicalOwners.length > 1) {
    throw new Error(
      `Executable test has multiple test layout owners: ${normalized}`,
    );
  }

  const canonicalOwner = canonicalOwners[0];
  if (canonicalOwner) {
    return {
      kind: "canonical",
      path: normalized,
      level: canonicalOwner.level,
      suite: canonicalOwner.suite,
      ...(canonicalOwner.variant ? { variant: canonicalOwner.variant } : {}),
      runner: runnerForExecutableKind(canonicalOwner.runner, executableKind),
    };
  }

  const migrationOwners = migrationEntries.filter((entry) =>
    normalized.startsWith(normalizeProjectPath(entry.pathPrefix))
  );

  if (migrationOwners.length === 0) {
    if (isSupportOrFixturePath(normalized)) {
      throw new Error(
        `support or fixture executable has no owner: ${normalized}`,
      );
    }
    throw new Error(`Executable test has no test layout owner: ${normalized}`);
  }
  if (migrationOwners.length > 1) {
    throw new Error(
      `Executable test has multiple test layout owners: ${normalized}`,
    );
  }

  const migrationOwner = migrationOwners[0];
  return {
    kind: "migration",
    path: normalized,
    level: migrationOwner.level,
    suite: migrationOwner.suite,
    runner: runnerForExecutableKind(migrationOwner.runner, executableKind),
    migrationEntry: migrationOwner.id,
  };
}

export async function collectExecutableTestFiles(
  root = ".",
): Promise<string[]> {
  const files: string[] = [];
  for await (
    const entry of walk(root, {
      includeDirs: false,
      skip: [
        /(^|\/)\.git(\/|$)/,
        /(^|\/)\.deno_cache(\/|$)/,
        /(^|\/)coverage(\/|$)/,
        /(^|\/)dist(\/|$)/,
        /(^|\/)node_modules(\/|$)/,
        /(^|\/)npm(\/|$)/,
      ],
    })
  ) {
    const path = normalizeProjectPath(entry.path);
    const relative = relativeProjectPath(root, path);
    if (isIgnoredRoot(relative)) continue;
    if (getExecutableTestKind(relative)) files.push(relative);
  }
  return files.sort((a, b) => a.localeCompare(b));
}

export async function validateTestLayout(
  options: ValidateTestLayoutOptions = {},
): Promise<TestLayoutValidationResult> {
  const startedAt = performance.now();
  const root = options.root ?? ".";
  const suites = options.suites ?? LEAF_TEST_SUITES;
  const migrationEntries = options.migrationEntries ??
    TEST_LAYOUT_MIGRATION_ENTRIES;
  const errors: string[] = [];
  try {
    validateLeafSuiteRegistry(suites);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  const files = await collectExecutableTestFiles(root);
  let canonical = 0;
  let migration = 0;
  const migrationCounts = new Map(
    migrationEntries.map((entry) => [entry.id, 0]),
  );

  for (const file of files) {
    try {
      const classification = classifyTestPath(file, {
        suites,
        migrationEntries,
      });
      if (classification.kind === "canonical") canonical += 1;
      if (classification.kind === "migration") {
        migration += 1;
        migrationCounts.set(
          classification.migrationEntry,
          (migrationCounts.get(classification.migrationEntry) ?? 0) + 1,
        );
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  for (const entry of migrationEntries) {
    const actual = migrationCounts.get(entry.id) ?? 0;
    if (actual !== entry.count) {
      errors.push(
        `Test layout migration allowlist count changed for ${entry.id}: expected ${entry.count}, found ${actual}`,
      );
    }
  }

  const result = {
    files: files.length,
    canonical,
    migration,
    timingMs: Math.round(performance.now() - startedAt),
    errors,
  };
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
  return result;
}

async function main(): Promise<void> {
  try {
    const result = await validateTestLayout();
    console.log(
      `test-layout: ${result.files} executable tests; ${result.canonical} canonical; ${result.migration} migration; ${result.timingMs}ms`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  }
}

function runnerForExecutableKind(
  configured: ResolvedLeafSuiteOwner["runner"],
  executableKind: ExecutableTestKind,
): ResolvedLeafSuiteOwner["runner"] {
  if (executableKind === "playwright") return "playwright";
  return configured;
}

function isSupportOrFixturePath(path: string): boolean {
  return path.includes("/_helpers/") || path.includes("/fixtures/") ||
    path.startsWith("tests/_helpers/") || path.startsWith("tests/fixtures/");
}

function relativeProjectPath(root: string, path: string): string {
  const normalizedRoot = normalizeProjectPath(root);
  if (normalizedRoot === ".") return path;
  return path.startsWith(`${normalizedRoot}/`)
    ? path.slice(normalizedRoot.length + 1)
    : path;
}

function normalizeProjectPath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function isIgnoredRoot(path: string): boolean {
  return IGNORED_ROOTS.has(path.split("/")[0] ?? "");
}

if (import.meta.main) {
  await main();
}
