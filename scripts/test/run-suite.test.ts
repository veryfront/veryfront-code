import { walk } from "#std/fs/walk";
import {
  assert,
  assertEquals,
  assertRejects,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { relative } from "node:path";
import { DENO_ONLY_TESTS } from "../../tests/deno-only-tests.mjs";
import {
  filterTestFiles,
  isDenoDependentTestSource,
  listTestFiles,
} from "../../tests/test-file-utils.mjs";
import {
  buildDenoSuiteCommandArgs,
  DENO_SUITE_PROFILES,
  parseDenoSuiteArgs,
} from "./run-deno-suite.ts";
import {
  DENO_TEST_ENV,
  LEAF_TEST_SUITES,
  PROVIDER_EGRESS_DENY_NET,
} from "./suites.ts";
import { classifyTestPath } from "./test-layout.ts";
import {
  formatSuitePlan,
  planSuiteFiles,
  selectOrdinalShard,
  type SuitePlanId,
} from "./run-suite.ts";

const UNIT_CWD_FILES = [
  "cli/commands/skills/validate.test.ts",
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
      "coverage:integration": await legacyIntegrationRootFiles(),
      "e2e:rsc-browser": [
        "tests/e2e/regressions/2026-07-27-legacy-router-hydration.test.ts",
        "tests/e2e/regressions/2026-07-27-release-asset-page-island-hydration.test.ts",
        "tests/e2e/regressions/2026-08-14-server-layout-spa-fallback.test.ts",
        "tests/e2e/regressions/dev-ui-browser-bundle.test.ts",
        "tests/e2e/regressions/rsc-proxy-hydration.test.ts",
      ],
      "e2e:binary": ["tests/integration/compiled-binary-e2e.test.ts"],
      "runtime:node": await legacyRuntimeFiles("node"),
      "runtime:bun": await legacyRuntimeFiles("bun"),
    };

    for (const [suite, files] of Object.entries(expected)) {
      const plan = await planSuiteFiles({ suite: suite as SuitePlanId });
      assertEquals(plan.files, sorted(files), suite);
    }
  });

  it("runs every root the unit suite claims to own", async () => {
    // Regression guard. suites.ts, deno.json's test.include and
    // suites.test.ts all place extensions/ and react/ in the unit suite, but
    // UNIT_ROOTS omitted them, so 90 extension test files never executed while
    // extensions/*/src/** still counted toward the 80% coverage gate.
    const plan = await planSuiteFiles({ suite: "coverage:unit" });

    for (const root of LEGACY_UNIT_ROOTS) {
      assert(
        plan.files.some((path) => path.startsWith(`${root}/`)),
        `the unit suite owns ${root}/ but planned no test file from it`,
      );
    }
  });

  it("keeps runtime-guarded Deno references eligible for Node", async () => {
    // `tests/test-file-utils.mjs` owns which sources count as Deno-dependent,
    // and a file opting out with the runtime-guarded header runs on Node. A
    // second copy of that rule inside the planner would drop the file again
    // while every runner still reported a pass, so the plan is asserted here
    // rather than the predicate.
    const plan = await planSuiteFiles({ suite: "runtime:node" });

    assert(
      plan.files.includes("src/routing/api/module-loader/loader.test.ts"),
      "the Node plan must keep runtime-guarded module-loader coverage",
    );
  });

  it("runs the sandbox runtime guard in the Node and Bun suites", async () => {
    const guardFile =
      "tests/integration/security/sandbox-runtime-guard.test.ts";

    for (const suite of ["runtime:node", "runtime:bun"] as const) {
      const plan = await planSuiteFiles({ suite });
      assert(
        plan.files.includes(guardFile),
        `${suite} must select the sandbox runtime guard coverage`,
      );
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

  it("uses locale-independent ordinal ordering for shard membership", () => {
    assertEquals(
      selectOrdinalShard(
        ["src/a.test.ts", "src/Z.test.ts"],
        { index: 1, total: 1 },
      ),
      ["src/Z.test.ts", "src/a.test.ts"],
    );
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

  it("rejects runtime-only patterns for Deno suites", async () => {
    await assertRejects(
      () =>
        planSuiteFiles({
          suite: "unit:parallel",
          patterns: ["src/example.test.ts"],
        }),
      Error,
      "does not accept pattern arguments",
    );
  });

  it("returns filtered empty Node plans for the runtime adapter to reject", async () => {
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
      "src/testing/cwd.test.ts",
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
    // The hand-written flag branches let these lanes drift out of the shared
    // isolation contract; the profile records closed that gap, so the pins
    // now assert the intended flags are present rather than absent.
    assert(integration.some((arg) => arg.startsWith("--deny-net=")));
    assert(integration.includes("--trace-leaks"));
    assert(cliIntegration.includes("--preload=src/testing/preload.ts"));
    assert(cliIntegration.some((arg) => arg.startsWith("--deny-net=")));
    assert(cliIntegration.includes("--trace-leaks"));
    assertEquals(cliIntegration.at(-1), "cli/routes.integration.test.ts");
  });

  it("declares every isolation decision explicitly on every Deno suite", () => {
    // A field with a default is a field that can drift silently; the profile
    // type keeps them required and this pins the shape at runtime too.
    for (const [suite, profile] of Object.entries(DENO_SUITE_PROFILES)) {
      for (
        const field of [
          "preload",
          "denyNet",
          "traceLeaks",
          "parallel",
          "heap",
          "coverage",
        ] as const
      ) {
        assertEquals(
          typeof profile[field],
          "boolean",
          `${suite} must declare ${field} explicitly`,
        );
      }
      assert(Array.isArray(profile.extraFlags), `${suite} extraFlags`);
      assert(
        profile.env !== undefined && typeof profile.env === "object",
        `${suite} env`,
      );
    }
  });

  it("denies provider egress on every lane that does not opt out with a reason", () => {
    for (const [suite, profile] of Object.entries(DENO_SUITE_PROFILES)) {
      const args = buildDenoSuiteCommandArgs(
        suite as Parameters<typeof buildDenoSuiteCommandArgs>[0],
        ["src/example.test.ts"],
      );
      if (profile.denyNet) {
        assert(
          args.includes(PROVIDER_EGRESS_DENY_NET),
          `${suite} must render the provider deny-net flag`,
        );
      } else {
        assert(
          typeof profile.denyNetOptOutReason === "string" &&
            profile.denyNetOptOutReason.length > 0,
          `${suite} opts out of deny-net without a reason`,
        );
      }
    }
  });

  it("keeps the CI coverage lane on the local unit lane's execution contract", () => {
    // coverage:unit and unit:parallel already share planSuiteFiles selection;
    // this keeps their execution environment from splitting apart too.
    const coverage = DENO_SUITE_PROFILES["coverage:unit"];
    const unit = DENO_SUITE_PROFILES["unit:parallel"];

    assertEquals(coverage.env, unit.env);
    assertEquals(coverage.preload, unit.preload);
    assertEquals(coverage.denyNet, unit.denyNet);
    assertEquals(unit.env, DENO_TEST_ENV);
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
      "test:coverage:integration": "coverage:integration",
      "test:e2e:rsc-browser": "e2e:rsc-browser",
      "test:e2e:binary": "e2e:binary",
      "test:e2e:binary:fresh": "e2e:binary",
      "test:node": "runtime:node",
      "test:bun": "runtime:bun",
    };

    for (const [task, suite] of Object.entries(expectedProfiles)) {
      const value = tasks[task];
      const command = typeof value === "string" ? value : value?.command;
      assert(command, `${task} must remain a supported task`);
      assert(command.includes(suite), `${task} must route through ${suite}`);
      assertEquals(/\bwarn(?:ing)?\b/i.test(command), false);
      // The suite record owns the environment now; a prefix reappearing on a
      // task line is the start of the drift this migration removed.
      assertEquals(
        command.includes("DENO_TESTING="),
        false,
        `${task} must inherit its env from the suite record`,
      );
      if (command.includes("run-deno-suite.ts")) {
        assert(
          command.includes("--allow-env"),
          `${task} must let the suite runner sanitize its inherited environment`,
        );
      }
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

  it("routes the Dev UI browser bundle test through the browser E2E lane", async () => {
    const config = JSON.parse(
      await Deno.readTextFile(new URL("../../deno.json", import.meta.url)),
    );
    const task = config.tasks["test:e2e:rsc-browser"] as string | undefined;
    const browserBundleTest =
      "tests/e2e/regressions/dev-ui-browser-bundle.test.ts";

    assert(task, "browser E2E task must remain defined");
    assert(
      task.includes("--suite=e2e:rsc-browser"),
      "the browser E2E task must route through the e2e:rsc-browser suite",
    );
    const plan = await planSuiteFiles({ suite: "e2e:rsc-browser" });
    assert(
      plan.files.includes(browserBundleTest),
      "the Chromium-backed Dev UI bundle test needs an explicit browser-capable runner",
    );
    assertEquals(classifyTestPath(browserBundleTest), {
      kind: "canonical",
      path: browserBundleTest,
      level: "e2e",
      suite: "e2e",
      runner: "deno",
    });
  });
});

// Read from the suite registry rather than restated here. A second hand-kept
// copy of the roots is what let ownership and execution drift in the first
// place: it would keep passing while a newly owned root went unplanned.
// scripts/ is excluded for the reason documented on UNPLANNABLE_UNIT_ROOTS in
// run-suite.ts -- deno.json's root `exclude` hides it from the main config.
const LEGACY_UNIT_ROOTS = (LEAF_TEST_SUITES
  .find((suite) => suite.id === "unit")?.pathSelectors ?? [])
  .filter((root) => root !== "scripts/")
  .map((root) => root.replace(/\/$/, ""));

async function legacyUnitParallelFiles(): Promise<string[]> {
  const files = await collectLegacyTestFiles(LEGACY_UNIT_ROOTS);
  const excluded = new Set([
    ...UNIT_CWD_FILES,
    ...UNIT_CWD_EXCLUSION_FILES,
  ]);
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
    (await collectLegacyTestFiles(LEGACY_UNIT_ROOTS))
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
      "tests/integration/security/sandbox-runtime-guard.test.ts",
    ]
    : [
      "src/",
      "tests/bun/dynamic-alias-resolution.test.ts",
      "tests/bun/npm-protocol-resolution.test.ts",
      "tests/bun/workspace-resolution.test.ts",
      "tests/integration/security/sandbox-runtime-guard.test.ts",
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
    // Deliberately the shared predicate rather than a copy of it: a second
    // copy agrees with a stale planner and reports parity while the runtime
    // suite has already shrunk.
    if (isDenoDependentTestSource(source)) continue;
    portable.push(relative(Deno.cwd(), absolutePath).replaceAll("\\", "/"));
  }
  return sorted(portable);
}

function sorted(paths: readonly string[]): string[] {
  return [...paths].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0
  );
}
