import { parseArgs } from "#std/flags";
import { relative, resolve } from "node:path";
import {
  filterTestFiles,
  isDenoDependentTestSource,
  listTestFiles,
} from "../../tests/test-file-utils.mjs";
import { DENO_ONLY_TESTS } from "../../tests/deno-only-tests.mjs";
import { discoverTests } from "./test-layout.ts";
import { LEAF_TEST_SUITES } from "./suites.ts";

export type SuitePlanId =
  | "unit:parallel"
  | "unit:serial"
  | "unit:cwd"
  | "unit:cwd-exclusion"
  | "integration:legacy-source-roots"
  | "integration:legacy-tests-root"
  | "integration:cli"
  | "coverage:unit"
  | "coverage:integration"
  | "e2e:rsc-browser"
  | "e2e:binary"
  | "runtime:node"
  | "runtime:bun";

export type SuitePlanRunner = "deno" | "node" | "bun";

export interface SuiteShard {
  readonly index: number;
  readonly total: number;
}

export interface PlanSuiteOptions {
  readonly suite: SuitePlanId;
  readonly root?: string;
  readonly paths?: readonly string[];
  readonly patterns?: readonly string[];
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
  readonly shard?: SuiteShard;
}

export interface SuiteFilePlan {
  readonly version: 1;
  readonly suite: SuitePlanId;
  readonly runner: SuitePlanRunner;
  readonly files: readonly string[];
}

// deno.json's root `exclude` lists scripts/, so those files are undiscoverable
// under the main config -- `deno test` reports "No test modules found" for them.
// They run through the dedicated `test:scripts` task with scripts/test.deno.json
// instead, so the unit planner skips the root while the registry still owns it.
const UNPLANNABLE_UNIT_ROOTS = new Set(["scripts/"]);

/**
 * Derived from the unit suite's own `pathSelectors` so ownership and execution
 * cannot drift: a root added in suites.ts is planned here without a second
 * edit. Hardcoding the list is what left extensions/ and react/ owned by the
 * unit suite -- `resolveLeafSuiteOwners` said so and suites.test.ts asserted it
 * -- while no runner selected them, so 90 extension test files never executed
 * even though `--include=src/` still counted every extension package's own
 * `src` directory toward the coverage gate.
 */
const UNIT_ROOTS = (() => {
  const unit = LEAF_TEST_SUITES.find((suite) => suite.id === "unit");
  if (!unit) {
    throw new Error("The leaf suite registry no longer defines a unit suite.");
  }
  return unit.pathSelectors.filter((root) => !UNPLANNABLE_UNIT_ROOTS.has(root));
})();
const UNIT_CWD_FILES = [
  "cli/commands/skills/validate.test.ts",
  "src/platform/compat/process.test.ts",
  "src/testing/cwd.test.ts",
];
// These tests own process-global lifecycle and require a quiet process.
const UNIT_SERIAL_FILES = [
  "extensions/ext-bundler-esbuild/src/esbuild-bundler.test.ts",
];
const UNIT_CWD_EXCLUSION_FILES = [
  "src/testing/cwd-exclusion-a.test.ts",
  "src/testing/cwd-exclusion-b.test.ts",
];
// Chromium-backed hydration regressions; each spawns a real server and drives
// a browser page, so they run through their own serial lane rather than the
// parallel integration root.
const E2E_RSC_BROWSER_FILES = [
  "tests/e2e/regressions/2026-07-27-legacy-router-hydration.test.ts",
  "tests/e2e/regressions/2026-07-27-release-asset-page-island-hydration.test.ts",
  "tests/e2e/regressions/2026-08-14-server-layout-spa-fallback.test.ts",
  "tests/e2e/regressions/dev-ui-browser-bundle.test.ts",
  "tests/e2e/regressions/rsc-proxy-hydration.test.ts",
];
const E2E_BINARY_FILES = [
  "tests/integration/compiled-binary-e2e.test.ts",
];
const UNIT_PARALLEL_EXCLUSIONS = new Set([
  ...UNIT_SERIAL_FILES,
  ...UNIT_CWD_FILES,
  ...UNIT_CWD_EXCLUSION_FILES,
]);
const SSR_PIPELINE_RUNTIME_FIXTURE =
  "tests/integration/semantic-unit-boundary/src/transforms/pipeline/__fixtures__/fixture-runner-ssr.test.ts";
const RUNTIME_PATTERNS = {
  node: [
    "src/**/*.test.ts",
    "extensions/ext-bundler-esbuild/src/binary.test.ts",
    "tests/ensure-npm-links.test.mjs",
    "tests/test-file-utils.test.mjs",
    "tests/integration/renderer/render-generation.test.ts",
    "tests/integration/transforms/mdx-module-preparation.test.ts",
    "tests/integration/transforms/http-module-capture.test.ts",
    "tests/integration/runtime/compat/kv-polyfill.test.ts",
    "tests/integration/runtime/compat/spawn-missing-executable.test.ts",
    "tests/integration/security/sandbox-runtime-guard.test.ts",
    SSR_PIPELINE_RUNTIME_FIXTURE,
  ],
  bun: [
    "src/",
    "tests/bun/dynamic-alias-resolution.test.ts",
    "tests/bun/npm-protocol-resolution.test.ts",
    "tests/bun/workspace-resolution.test.ts",
    "tests/integration/renderer/render-generation.test.ts",
    "tests/integration/transforms/mdx-module-preparation.test.ts",
    "tests/integration/transforms/http-module-capture.test.ts",
    "tests/integration/runtime/compat/abort-signal-reason.test.ts",
    "tests/integration/runtime/compat/kv-polyfill.test.ts",
    "tests/integration/runtime/compat/spawn-missing-executable.test.ts",
    "tests/integration/security/sandbox-runtime-guard.test.ts",
    SSR_PIPELINE_RUNTIME_FIXTURE,
  ],
} as const;
const RUNTIME_EXCLUSIONS = {
  node: [
    "src/issues/**",
    ...DENO_ONLY_TESTS,
    "src/proxy/handler.test.ts",
    "src/proxy/oauth-client.test.ts",
    "src/proxy/token-priority.test.ts",
    "src/server/project-env/fetcher.test.ts",
  ],
  bun: [
    ...DENO_ONLY_TESTS,
    "src/config/env.test.ts",
    "src/proxy/handler.test.ts",
    "src/proxy/oauth-client.test.ts",
    "src/proxy/token-priority.test.ts",
    "src/server/project-env/fetcher.test.ts",
    "src/routing/api/module-loader/loader.test.ts",
  ],
} as const;

const RUNNERS: Record<SuitePlanId, SuitePlanRunner> = {
  "unit:parallel": "deno",
  "unit:serial": "deno",
  "unit:cwd": "deno",
  "unit:cwd-exclusion": "deno",
  "integration:legacy-source-roots": "deno",
  "integration:legacy-tests-root": "deno",
  "integration:cli": "deno",
  "coverage:unit": "deno",
  "coverage:integration": "deno",
  "e2e:rsc-browser": "deno",
  "e2e:binary": "deno",
  "runtime:node": "node",
  "runtime:bun": "bun",
};

export async function planSuiteFiles(
  options: PlanSuiteOptions,
): Promise<SuiteFilePlan> {
  const root = resolve(options.root ?? ".");
  const candidates = options.paths
    ? sortedUnique(options.paths)
    : await discoverCandidatePaths(options.suite, root, options.patterns);
  if (options.paths) await assertOwnedPaths(candidates);
  let files = await selectProfileFiles(options.suite, candidates, root);

  if (options.include?.length || options.exclude?.length) {
    files = filterTestFiles(
      files.map((path) => resolve(root, path)),
      {
        include: [...options.include ?? []],
        exclude: [...options.exclude ?? []],
      },
      root,
    ).map((path) => normalizeRelativePath(root, path));
  }
  files = sortedUnique(files);

  if (options.shard) {
    files = selectOrdinalShard(files, options.shard);
  }

  const filteredNodeEmpty = options.suite === "runtime:node" &&
    Boolean(options.include?.length || options.exclude?.length);
  if (files.length === 0 && !filteredNodeEmpty) {
    throw new SuitePlannerError(
      4,
      `${options.suite} selected no test files`,
    );
  }

  return {
    version: 1,
    suite: options.suite,
    runner: RUNNERS[options.suite],
    files,
  };
}

export function selectOrdinalShard(
  files: readonly string[],
  shard: SuiteShard,
): string[] {
  if (
    !Number.isInteger(shard.index) || !Number.isInteger(shard.total) ||
    shard.total < 1 || shard.index < 1 || shard.index > shard.total
  ) {
    throw new SuitePlannerError(
      2,
      "Invalid shard: expected 1 <= index <= total",
    );
  }
  return sortedUnique(files).filter(
    (_, index) => index % shard.total === shard.index - 1,
  );
}

export function formatSuitePlan(
  plan: SuiteFilePlan,
): string {
  return `${JSON.stringify(plan)}\n`;
}

async function discoverCandidatePaths(
  suite: SuitePlanId,
  root: string,
  patterns?: readonly string[],
): Promise<string[]> {
  if (suite === "runtime:node" || suite === "runtime:bun") {
    const runtime = suite === "runtime:node" ? "node" : "bun";
    const files = listTestFiles(
      [...patterns?.length ? patterns : RUNTIME_PATTERNS[runtime]],
      root,
    );
    const relativePaths = files.map((path) =>
      normalizeRelativePath(root, path)
    );
    await assertOwnedPaths(relativePaths);
    return relativePaths;
  }

  if (patterns?.length) {
    throw new SuitePlannerError(
      2,
      `${suite} does not accept pattern arguments`,
    );
  }

  const discovery = await discoverTests({ root });
  if (discovery.violations.length > 0) {
    throw new SuitePlannerError(
      3,
      discovery.violations.map(({ path, reason }) => `${path}: ${reason}`).join(
        "\n",
      ),
    );
  }
  return discovery.inventory.map((entry) => entry.path);
}

async function selectProfileFiles(
  suite: SuitePlanId,
  candidates: readonly string[],
  root: string,
): Promise<string[]> {
  switch (suite) {
    case "unit:parallel":
      return candidates.filter((path) =>
        startsWithAny(path, UNIT_ROOTS) && isTsTest(path) &&
        !isIntegrationTest(path) &&
        !path.startsWith("src/workflow/__tests__/") &&
        !UNIT_PARALLEL_EXCLUSIONS.has(path)
      );
    case "unit:serial":
      return candidates.filter((path) => UNIT_SERIAL_FILES.includes(path));
    case "unit:cwd":
      return candidates.filter((path) => UNIT_CWD_FILES.includes(path));
    case "unit:cwd-exclusion":
      return candidates.filter((path) =>
        UNIT_CWD_EXCLUSION_FILES.includes(path)
      );
    case "integration:legacy-source-roots":
      return candidates.filter((path) =>
        startsWithAny(path, UNIT_ROOTS) && isTsTest(path) &&
        isIntegrationTest(path)
      );
    case "integration:legacy-tests-root":
    case "coverage:integration":
      return candidates.filter((path) =>
        path.startsWith("tests/") && isDenoDiscoveredTest(path) &&
        !path.startsWith("tests/bun/") &&
        !path.startsWith("tests/e2e/") &&
        path !== "tests/integration/compiled-binary-e2e.test.ts"
      );
    case "e2e:rsc-browser":
      return candidates.filter((path) => E2E_RSC_BROWSER_FILES.includes(path));
    case "e2e:binary":
      return candidates.filter((path) => E2E_BINARY_FILES.includes(path));
    case "integration:cli":
      return candidates.filter((path) =>
        path.startsWith("cli/") && /\.integration\.test\.tsx?$/.test(path)
      );
    case "coverage:unit":
      return candidates.filter((path) =>
        startsWithAny(path, UNIT_ROOTS) && isTsTest(path) &&
        !isIntegrationTest(path) &&
        !path.startsWith("src/workflow/__tests__/")
      );
    case "runtime:node":
      return await selectRuntimeFiles("node", candidates, root);
    case "runtime:bun":
      return await selectRuntimeFiles("bun", candidates, root);
  }
}

async function selectRuntimeFiles(
  runtime: "node" | "bun",
  candidates: readonly string[],
  root: string,
): Promise<string[]> {
  const filtered = filterTestFiles(
    candidates.map((path) => resolve(root, path)),
    { exclude: [...RUNTIME_EXCLUSIONS[runtime]] },
    root,
  );
  const files: string[] = [];
  for (const path of filtered) {
    const source = await Deno.readTextFile(path);
    if (isDenoDependentTestSource(source)) continue;
    files.push(normalizeRelativePath(root, path));
  }
  return files;
}

async function assertOwnedPaths(paths: readonly string[]): Promise<void> {
  const discovery = await discoverTests({ paths });
  if (discovery.violations.length > 0) {
    throw new SuitePlannerError(
      3,
      discovery.violations.map(({ path, reason }) => `${path}: ${reason}`).join(
        "\n",
      ),
    );
  }
}

function isTsTest(path: string): boolean {
  return /\.test\.tsx?$/.test(path);
}

function isIntegrationTest(path: string): boolean {
  return /\.integration\.test\.tsx?$/.test(path);
}

function isDenoDiscoveredTest(path: string): boolean {
  return /(?:^|\/)(?:[^/]+[._]test|test)\.(?:js|mjs|ts|mts|jsx|tsx)$/.test(
    path,
  );
}

function startsWithAny(path: string, roots: readonly string[]): boolean {
  return roots.some((root) => path.startsWith(root));
}

function normalizeRelativePath(root: string, path: string): string {
  return relative(root, resolve(root, path)).replaceAll("\\", "/");
}

function sortedUnique(paths: readonly string[]): string[] {
  return [
    ...new Set(
      paths.map((path) => path.replaceAll("\\", "/").replace(/^\.\//, "")),
    ),
  ].sort(compareOrdinal);
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

class SuitePlannerError extends Error {
  constructor(readonly exitCode: number, message: string) {
    super(message);
  }
}

if (import.meta.main) {
  try {
    const [command, ...rawArgs] = Deno.args;
    if (command !== "plan") {
      throw new SuitePlannerError(
        2,
        "Usage: run-suite.ts plan --suite=<id>",
      );
    }
    const separator = rawArgs.indexOf("--");
    const optionArgs = separator === -1 ? rawArgs : rawArgs.slice(0, separator);
    const patterns = separator === -1 ? [] : rawArgs.slice(separator + 1);
    const flags = parseArgs(optionArgs, {
      string: ["suite", "root", "include", "exclude", "shard"],
      collect: ["include", "exclude"],
    });
    if (!flags.suite || !(flags.suite in RUNNERS)) {
      throw new SuitePlannerError(2, `Unknown suite: ${flags.suite ?? ""}`);
    }
    const plan = await planSuiteFiles({
      suite: flags.suite as SuitePlanId,
      ...(flags.root ? { root: flags.root } : {}),
      ...(patterns.length ? { patterns } : {}),
      ...(flags.include?.length ? { include: flags.include } : {}),
      ...(flags.exclude?.length ? { exclude: flags.exclude } : {}),
      ...(flags.shard ? { shard: parseShard(flags.shard) } : {}),
    });
    await Deno.stdout.write(new TextEncoder().encode(formatSuitePlan(plan)));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(error instanceof SuitePlannerError ? error.exitCode : 3);
  }
}

function parseShard(value: string): SuiteShard {
  const match = /^(\d+)\/(\d+)$/.exec(value);
  if (!match) throw new SuitePlannerError(2, `Invalid shard: ${value}`);
  return { index: Number(match[1]), total: Number(match[2]) };
}
