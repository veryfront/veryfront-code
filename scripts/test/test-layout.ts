import { parseArgs } from "#std/flags";
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

export interface TestLayoutInventoryEntry {
  readonly path: string;
  readonly level: ResolvedLeafSuiteOwner["level"];
  readonly suite: ResolvedLeafSuiteOwner["suite"];
  readonly runner: ResolvedLeafSuiteOwner["runner"];
  readonly variant?: TestLayoutMigrationEntry["variant"];
  readonly kind: "canonical" | "migration";
}

export type TestLayoutClassification =
  & TestLayoutInventoryEntry
  & (
    | { readonly kind: "canonical" }
    | {
      readonly kind: "migration";
      readonly migrationEntry: Pick<
        TestLayoutMigrationEntry,
        "path" | "owner" | "removalPr"
      >;
    }
  );

export interface ValidateTestLayoutOptions {
  readonly root?: string;
  readonly paths?: readonly string[];
  readonly suites?: readonly LeafTestSuite[];
  readonly migrationEntries?: readonly TestLayoutMigrationEntry[];
}

export interface TestLayoutViolation {
  readonly path: string;
  readonly reason: string;
}

export interface TestLayoutDiscoveryResult {
  readonly inventory: readonly TestLayoutInventoryEntry[];
  readonly violations: readonly TestLayoutViolation[];
}

export interface TestLayoutValidationResult {
  readonly files: number;
  readonly canonical: number;
  readonly migration: number;
  readonly timingMs: number;
  readonly errors: readonly string[];
  readonly inventory: readonly TestLayoutInventoryEntry[];
}

const DENO_TEST_PATTERN = /\.test\.(?:ts|tsx|js|mjs|cjs)$/;
const PLAYWRIGHT_TEST_PATTERN = /\.playwright\.ts$/;
const TEST_LIKE_PATTERN = /\.(?:test|spec|playwright)\.[^/]+$/;
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
  if (PLAYWRIGHT_TEST_PATTERN.test(normalized)) return "playwright";
  if (DENO_TEST_PATTERN.test(normalized)) return "deno";
  return undefined;
}

export function classifyTestPath(
  path: string,
  options: Omit<ValidateTestLayoutOptions, "root" | "paths"> = {},
): TestLayoutClassification {
  const normalized = normalizeProjectPath(path);
  const executableKind = getExecutableTestKind(normalized);
  if (!executableKind) {
    const message = looksLikeTestPath(normalized)
      ? "unsupported test-like filename"
      : "Unsupported or non-executable test path";
    throw new Error(`${message}: ${normalized}`);
  }

  if (isSupportOrFixturePath(normalized)) {
    throw new Error(
      `support or fixture executable has no owner: ${normalized}`,
    );
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
      runner: runnerForExecutableKind(canonicalOwner.runner, executableKind),
    };
  }

  const migrationOwners = migrationEntries.filter((entry) =>
    normalizeProjectPath(entry.path) === normalized
  );
  if (migrationOwners.length === 0) {
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
    ...(migrationOwner.variant ? { variant: migrationOwner.variant } : {}),
    migrationEntry: {
      path: migrationOwner.path,
      owner: migrationOwner.owner,
      removalPr: migrationOwner.removalPr,
    },
  };
}

export async function discoverTests(
  options: Pick<
    ValidateTestLayoutOptions,
    "root" | "paths" | "suites" | "migrationEntries"
  > = {},
): Promise<TestLayoutDiscoveryResult> {
  const paths = options.paths
    ? [...options.paths].map(normalizeProjectPath)
    : await collectTestLikeFiles(options.root ?? ".");
  const inventory: TestLayoutInventoryEntry[] = [];
  const violations: TestLayoutViolation[] = [];

  for (const path of paths.sort((a, b) => a.localeCompare(b))) {
    try {
      const classification = classifyTestPath(path, {
        suites: options.suites,
        migrationEntries: options.migrationEntries,
      });
      inventory.push(toInventoryEntry(classification));
    } catch (error) {
      violations.push({
        path,
        reason: error instanceof Error
          ? violationReason(error.message)
          : String(error),
      });
    }
  }

  return { inventory, violations };
}

export async function collectExecutableTestFiles(
  root = ".",
): Promise<string[]> {
  const discovery = await discoverTests({ root });
  return discovery.inventory.map((entry) => entry.path);
}

export async function validateTestLayout(
  options: ValidateTestLayoutOptions = {},
): Promise<TestLayoutValidationResult> {
  const startedAt = performance.now();
  const suites = options.suites ?? LEAF_TEST_SUITES;
  const migrationEntries = options.migrationEntries ??
    TEST_LAYOUT_MIGRATION_ENTRIES;
  const errors: string[] = [];

  try {
    validateLeafSuiteRegistry(suites);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  const discovery = await discoverTests({
    root: options.root,
    paths: options.paths,
    suites,
    migrationEntries,
  });
  errors.push(
    ...discovery.violations.map((violation) =>
      `${violation.reason}: ${violation.path}`
    ),
  );

  const strictStaleMigrationCheck = options.paths === undefined ||
    options.migrationEntries !== undefined;
  errors.push(
    ...validateMigrationEntries(
      discovery,
      migrationEntries,
      strictStaleMigrationCheck,
    ),
  );

  const canonical =
    discovery.inventory.filter((entry) => entry.kind === "canonical").length;
  const migration =
    discovery.inventory.filter((entry) => entry.kind === "migration").length;
  const result = {
    files: discovery.inventory.length,
    canonical,
    migration,
    timingMs: Math.round(performance.now() - startedAt),
    errors,
    inventory: discovery.inventory,
  };
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }
  return result;
}

export function shardTests(
  paths: readonly string[],
  shardIndex: number,
  shardTotal: number,
): readonly string[] {
  if (!Number.isInteger(shardIndex) || !Number.isInteger(shardTotal)) {
    throw new Error("Shard index and total must be integers");
  }
  if (shardTotal < 1) throw new Error("Shard total must be at least 1");
  if (shardIndex < 1 || shardIndex > shardTotal) {
    throw new Error("Shard index must be between 1 and shard total");
  }

  return [...paths]
    .map(normalizeProjectPath)
    .filter((path) => stablePathHash(path) % shardTotal === shardIndex - 1)
    .sort((a, b) => a.localeCompare(b));
}

async function main(): Promise<void> {
  try {
    const flags = parseArgs(Deno.args, {
      boolean: ["json"],
      default: { json: false },
    });
    const result = await validateTestLayout();
    if (flags.json) {
      console.log(JSON.stringify(result.inventory, null, 2));
      return;
    }
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

async function collectTestLikeFiles(root = "."): Promise<string[]> {
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
    if (looksLikeTestPath(relative)) files.push(relative);
  }
  return files;
}

function toInventoryEntry(
  classification: TestLayoutClassification,
): TestLayoutInventoryEntry {
  const entry: TestLayoutInventoryEntry = {
    path: classification.path,
    level: classification.level,
    suite: classification.suite,
    runner: classification.runner,
    ...(classification.variant ? { variant: classification.variant } : {}),
    kind: classification.kind,
  };
  return entry;
}

function validateMigrationEntries(
  discovery: TestLayoutDiscoveryResult,
  migrationEntries: readonly TestLayoutMigrationEntry[],
  strictStaleMigrationCheck: boolean,
): string[] {
  const errors: string[] = [];
  const migrationPaths = new Set(
    discovery.inventory
      .filter((entry) => entry.kind === "migration")
      .map((entry) => entry.path),
  );

  for (const entry of migrationEntries) {
    const normalized = normalizeProjectPath(entry.path);
    if (!entry.owner || !entry.removalPr) {
      errors.push(`migration entry missing owner/removal PR: ${normalized}`);
      continue;
    }
    if (strictStaleMigrationCheck && !migrationPaths.has(normalized)) {
      errors.push(`stale migration entry must be removed: ${normalized}`);
    }
  }

  return errors;
}

function violationReason(message: string): string {
  if (message.startsWith("unsupported test-like filename")) {
    return "unsupported test-like filename";
  }
  if (message.startsWith("support or fixture executable")) {
    return "support or fixture executable";
  }
  if (message.includes("multiple test layout owners")) {
    return "multiple test layout owners";
  }
  if (message.includes("no test layout owner")) {
    return "no test layout owner";
  }
  return message;
}

function looksLikeTestPath(path: string): boolean {
  return TEST_LIKE_PATTERN.test(path);
}

function isSupportOrFixturePath(path: string): boolean {
  return path.startsWith("tests/fixtures/") ||
    path.includes("/fixtures/") && path.startsWith("tests/") ||
    path.startsWith("tests/support/") ||
    path.includes("/support/") && path.startsWith("tests/");
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

function stablePathHash(path: string): number {
  let hash = 0x811c9dc5;
  for (const char of path) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

if (import.meta.main) {
  await main();
}
