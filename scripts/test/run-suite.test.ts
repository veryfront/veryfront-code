import { assert, assertEquals, assertRejects } from "#std/assert";
import { walk } from "#std/fs/walk";
import { describe, it } from "#std/testing/bdd";
import { relative } from "node:path";
import { DENO_ONLY_TESTS } from "../../tests/deno-only-tests.mjs";
import {
  filterTestFiles,
  listTestFiles,
} from "../../tests/test-file-utils.mjs";
import {
  buildDenoSuiteCommandArgs,
  parseDenoSuiteArgs,
} from "./run-deno-suite.ts";
import {
  formatSuitePlan,
  planSuiteFiles,
  type SuitePlanId,
} from "./run-suite.ts";

const UNIT_CWD_FILES = [
  "cli/router.test.ts",
  "cli/app/operations/project-creation.test.ts",
  "cli/commands/schedule/handler.test.ts",
  "cli/commands/skills/validate.test.ts",
  "cli/commands/webhook/handler.test.ts",
  "src/platform/compat/process.test.ts",
  "src/testing/cwd.test.ts",
];

const UNIT_CWD_EXCLUSION_FILES = [
  "src/testing/cwd-exclusion-a.test.ts",
  "src/testing/cwd-exclusion-b.test.ts",
];

describe("suite planning parity", () => {
  it("preserves every legacy command inventory", async () => {
    const expected: Record<SuitePlanId, string[]> = {
      "unit:parallel": await legacyUnitParallelFiles(),
      "unit:cwd": UNIT_CWD_FILES,
      "unit:cwd-exclusion": UNIT_CWD_EXCLUSION_FILES,
      "integration:legacy-tests-root": await legacyIntegrationRootFiles(),
      "integration:cli": await legacyCliIntegrationFiles(),
      "coverage:unit": await legacyUnitCoverageFiles(),
      "runtime:node": await legacyRuntimeFiles("node"),
      "runtime:bun": await legacyRuntimeFiles("bun"),
    };

    for (const [suite, files] of Object.entries(expected)) {
      const plan = await planSuiteFiles({ suite: suite as SuitePlanId });
      assertEquals(plan.files, sorted(files), suite);
    }
  });

  it("keeps eight coverage shards complete, disjoint, and ordered", async () => {
    const paths = Array.from(
      { length: 27 },
      (_, index) =>
        `src/example-${String(26 - index).padStart(2, "0")}.test.ts`,
    );
    const shards = await Promise.all(
      Array.from(
        { length: 8 },
        (_, index) =>
          planSuiteFiles({
            suite: "coverage:unit",
            paths,
            shard: { index: index + 1, total: 8 },
          }),
      ),
    );
    const flattened = shards.flatMap((plan) => plan.files);

    assertEquals(new Set(flattened).size, paths.length);
    assertEquals(sorted(flattened), sorted(paths));
    for (const plan of shards) assertEquals(plan.files, sorted(plan.files));
  });

  it("fails closed when an unfiltered profile selects no files", async () => {
    const root = await Deno.makeTempDir();
    try {
      await assertRejects(
        () => planSuiteFiles({ suite: "unit:parallel", root }),
        Error,
        "selected no test files",
      );
      await assertRejects(
        () => planSuiteFiles({ suite: "runtime:bun", root }),
        Error,
        "selected no test files",
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("retains Node's filtered empty-selection compatibility only", async () => {
    const root = await Deno.makeTempDir();
    try {
      assertEquals(
        await planSuiteFiles({
          suite: "runtime:node",
          root,
          include: ["src/does-not-exist.test.ts"],
        }),
        {
          version: 1,
          suite: "runtime:node",
          runner: "node",
          files: [],
        },
      );
      await assertRejects(
        () =>
          planSuiteFiles({
            suite: "runtime:bun",
            root,
            include: ["src/does-not-exist.test.ts"],
          }),
        Error,
        "selected no test files",
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });

  it("formats a stable machine-readable planner contract", async () => {
    const plan = await planSuiteFiles({
      suite: "coverage:unit",
      paths: ["src/z.test.ts", "src/a.test.ts"],
    });

    assertEquals(JSON.parse(formatSuitePlan(plan)), plan);
  });
});

describe("migration command surface", () => {
  it("preserves Deno launch flags while passing files as argv elements", () => {
    const parallel = buildDenoSuiteCommandArgs("unit:parallel", [
      "src/a test.test.ts",
    ]);
    const cwd = buildDenoSuiteCommandArgs("unit:cwd", [
      "cli/router.test.ts",
    ]);
    const integration = buildDenoSuiteCommandArgs(
      "integration:legacy-tests-root",
      ["tests/routes.test.ts"],
    );
    const cliIntegration = buildDenoSuiteCommandArgs(
      "integration:cli",
      [
        "cli/routes.integration.test.ts",
      ],
    );

    assert(parallel.includes("--parallel"));
    assert(parallel.includes("--trace-leaks"));
    assert(parallel.some((arg) => arg.startsWith("--deny-net=")));
    assertEquals(parallel.at(-1), "src/a test.test.ts");
    assertEquals(cwd.includes("--parallel"), false);
    assert(integration.includes("--parallel"));
    assertEquals(
      integration.some((arg) => arg.startsWith("--deny-net=")),
      false,
    );
    assertEquals(
      cliIntegration.includes("--preload=src/testing/preload.ts"),
      false,
    );
    assertEquals(cliIntegration.at(-1), "cli/routes.integration.test.ts");
  });

  it("forwards task-level Deno flags before selected files", () => {
    const parsed = parseDenoSuiteArgs([
      "--suite=integration:legacy-tests-root",
      "--no-lock",
    ]);
    assertEquals(parsed, {
      suite: "integration:legacy-tests-root",
      passthroughArgs: ["--no-lock"],
    });

    const args = buildDenoSuiteCommandArgs(
      "integration:legacy-tests-root",
      ["tests/routes.test.ts"],
      parsed,
    );

    assertEquals(args.slice(-2), ["--no-lock", "tests/routes.test.ts"]);
  });

  it("routes affected compatibility tasks through declared suite profiles", async () => {
    const config = JSON.parse(
      await Deno.readTextFile(new URL("../../deno.json", import.meta.url)),
    );
    const tasks = config.tasks as Record<string, string | { command: string }>;
    const expectedProfiles: Record<string, SuitePlanId> = {
      "test:unit:parallel": "unit:parallel",
      "test:unit:cwd": "unit:cwd",
      "test:unit:cwd-exclusion": "unit:cwd-exclusion",
      "test:integration": "integration:legacy-tests-root",
      "test:integration:cli": "integration:cli",
      "test:coverage:unit": "coverage:unit",
      "test:node": "runtime:node",
      "test:bun": "runtime:bun",
    };

    for (const [task, suite] of Object.entries(expectedProfiles)) {
      const value = tasks[task];
      const command = typeof value === "string" ? value : value?.command;
      assert(command, `${task} must remain a supported task`);
      assert(command.includes(suite), `${task} must route through ${suite}`);
      assertEquals(/\bwarn(?:ing)?\b/i.test(command), false);
    }

    for (
      const alias of [
        "test",
        "test:unit",
        "test:integration",
        "coverage:ci:shard",
        "coverage:ci:merge",
        "test:node",
        "test:bun",
        "test:e2e",
        "test:e2e:binary",
      ]
    ) {
      assert(tasks[alias], `${alias} compatibility alias must remain defined`);
    }
  });

  it("keeps pre-push aligned with an existing E2E task", async () => {
    const config = JSON.parse(
      await Deno.readTextFile(new URL("../../deno.json", import.meta.url)),
    );
    const hook = await Deno.readTextFile(
      new URL("../../scripts/hooks/pre-push", import.meta.url),
    );
    const match = /deno task (test:e2e:[a-z-]+)/.exec(hook);

    assert(match, "pre-push must invoke a named E2E task");
    assert(config.tasks[match[1]], `${match[1]} must exist in deno.json`);
  });
});

async function legacyUnitParallelFiles(): Promise<string[]> {
  const files = await collectLegacyTestFiles(["src", "cli", "templates"]);
  const excluded = new Set([...UNIT_CWD_FILES, ...UNIT_CWD_EXCLUSION_FILES]);
  return sorted(
    files.filter((path) =>
      !path.includes(".integration.test.ts") &&
      !path.includes(".integration.test.tsx") &&
      !path.startsWith("src/workflow/__tests__/") &&
      !excluded.has(path)
    ),
  );
}

async function legacyCliIntegrationFiles(): Promise<string[]> {
  return sorted(
    (await collectLegacyTestFiles(["cli"]))
      .filter((path) => /\.integration\.test\.tsx?$/.test(path)),
  );
}

async function legacyUnitCoverageFiles(): Promise<string[]> {
  return sorted(
    (await collectLegacyTestFiles(["src", "cli", "templates"]))
      .filter((path) => !/\.integration\.test\.tsx?$/.test(path))
      .filter((path) => !path.startsWith("src/workflow/__tests__/")),
  );
}

async function legacyIntegrationRootFiles(): Promise<string[]> {
  return sorted(
    (await collectLegacyTestFiles(["tests"], true))
      .filter((path) => !path.startsWith("tests/e2e/"))
      .filter((path) =>
        path !== "tests/integration/compiled-binary-e2e.test.ts"
      ),
  );
}

async function collectLegacyTestFiles(
  roots: readonly string[],
  denoExtensions = false,
): Promise<string[]> {
  const files: string[] = [];
  const pattern = denoExtensions
    ? /(?:^|\/)(?:[^/]+[._]test|test)\.(?:js|mjs|ts|mts|jsx|tsx)$/
    : /\.test\.tsx?$/;

  for (const root of roots) {
    for await (
      const entry of walk(root, {
        includeDirs: false,
        skip: [/(^|\/)node_modules(\/|$)/, /(^|\/)npm(\/|$)/],
      })
    ) {
      const path = entry.path.replaceAll("\\", "/").replace(/^\.\//, "");
      if (pattern.test(path)) files.push(path);
    }
  }
  return sorted(files);
}

async function legacyRuntimeFiles(runtime: "node" | "bun"): Promise<string[]> {
  const patterns = runtime === "node"
    ? [
      "src/**/*.test.ts",
      "extensions/ext-bundler-esbuild/src/binary.test.ts",
      "tests/ensure-npm-links.test.mjs",
      "tests/test-file-utils.test.mjs",
    ]
    : [
      "src/",
      "tests/bun/dynamic-alias-resolution.test.ts",
      "tests/bun/npm-protocol-resolution.test.ts",
      "tests/bun/workspace-resolution.test.ts",
    ];
  const incompatible = runtime === "node"
    ? [
      "src/issues/**",
      "src/cache/backend.test.ts",
      ...DENO_ONLY_TESTS,
      "src/proxy/handler.test.ts",
      "src/proxy/oauth-client.test.ts",
      "src/proxy/token-priority.test.ts",
      "src/server/project-env/fetcher.test.ts",
    ]
    : [
      ...DENO_ONLY_TESTS,
      "src/config/env.test.ts",
      "src/proxy/handler.test.ts",
      "src/proxy/oauth-client.test.ts",
      "src/proxy/token-priority.test.ts",
      "src/server/project-env/fetcher.test.ts",
      "src/routing/api/module-loader/loader.test.ts",
    ];
  const files = filterTestFiles(listTestFiles(patterns), {
    exclude: incompatible,
  });
  const portable: string[] = [];
  for (const absolutePath of files) {
    const source = await Deno.readTextFile(absolutePath);
    if (
      /\bDeno\./.test(source) ||
      /tests\/_helpers\/utils\.ts/.test(source) ||
      /\bcreateMockServer\s*\(/.test(source)
    ) continue;
    portable.push(relative(Deno.cwd(), absolutePath).replaceAll("\\", "/"));
  }
  return sorted(portable);
}

function sorted(paths: readonly string[]): string[] {
  return [...paths].sort((a, b) => a.localeCompare(b));
}
