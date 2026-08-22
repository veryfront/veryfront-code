import { assertEquals, assertRejects, assertThrows } from "#std/assert";
import { ensureDir } from "#std/fs/ensure-dir";
import { dirname, join } from "#std/path";
import { describe, it } from "#std/testing/bdd";
import {
  classifyTestPath,
  collectExecutableTestFiles,
  discoverTests,
  getExecutableTestKind,
  parseMigrationBaselineSource,
  shardTests,
  validateMigrationPathRatchet,
  validateTestLayout,
} from "./test-layout.ts";
import type { TestLayoutMigrationEntry } from "./test-layout-migration.ts";
import { TEST_LAYOUT_MIGRATION_ENTRIES } from "./test-layout-migration.ts";

describe("test path executable classification", () => {
  it("accepts exactly the supported executable filename contract", () => {
    // Production break caught: test discovery accepts a filename pattern before
    // the taxonomy registry has explicit ownership for that executable form.
    assertEquals(getExecutableTestKind("src/example.test.ts"), "deno");
    assertEquals(getExecutableTestKind("src/example.test.tsx"), "deno");
    assertEquals(getExecutableTestKind("src/example.test.js"), "deno");
    assertEquals(getExecutableTestKind("src/example.test.mjs"), "deno");
    assertEquals(getExecutableTestKind("src/example.test.cjs"), "deno");
    assertEquals(
      getExecutableTestKind("tests/e2e/example.playwright.ts"),
      "playwright",
    );

    assertEquals(getExecutableTestKind("src/example.test.jsx"), undefined);
    assertEquals(getExecutableTestKind("src/example.spec.ts"), undefined);
    assertEquals(
      getExecutableTestKind("tests/e2e/example.playwright.tsx"),
      undefined,
    );
    assertEquals(
      getExecutableTestKind("tests/e2e/example.playwright.js"),
      undefined,
    );
    assertEquals(
      getExecutableTestKind("tests/e2e/example.playwright.mjs"),
      undefined,
    );
    assertEquals(
      getExecutableTestKind("tests/e2e/example.playwright.cjs"),
      undefined,
    );
  });

  it("discovers unsupported test-like files instead of silently dropping them", async () => {
    // Production break caught: src/foo.test.jsx, src/foo.spec.ts, and
    // tests/e2e/foo.playwright.js are invisible to repository validation.
    const root = await Deno.makeTempDir();
    try {
      await writeFixture(root, "src/ok.test.ts");
      await writeFixture(root, "src/bad.test.jsx");
      await writeFixture(root, "src/bad.spec.ts");
      await writeFixture(root, "tests/e2e/bad.playwright.js");

      const result = await discoverTests({ root });

      assertEquals(result.inventory.map((entry) => entry.path), [
        "src/ok.test.ts",
      ]);
      assertEquals(result.violations.map((violation) => violation.path), [
        "src/bad.spec.ts",
        "src/bad.test.jsx",
        "tests/e2e/bad.playwright.js",
      ]);
      assertEquals(
        result.violations.map((violation) => violation.reason),
        [
          "unsupported test-like filename",
          "unsupported test-like filename",
          "unsupported test-like filename",
        ],
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  });
});

describe("test layout path ownership", () => {
  it("classifies approved canonical unit roots as unit leaf ownership", () => {
    // Production break caught: colocated unit roots are kept in the migration
    // inventory while tests/unit is treated as the canonical destination.
    for (
      const path of [
        "src/agent/factory.test.ts",
        "cli/router.test.ts",
        "extensions/ext-bundler-esbuild/src/binary.test.ts",
        "templates/scaffold-parity.test.ts",
        "scripts/test/test-layout.test.ts",
        "react/react.test.ts",
      ]
    ) {
      assertEquals(classifyTestPath(path), {
        kind: "canonical",
        path,
        level: "unit",
        suite: "unit",
        runner: "deno",
      });
    }
  });

  it("classifies integration and e2e canonical trees into runner inventory fields", () => {
    // Production break caught: validation counts files but drops the emitted
    // path-to-level-to-leaf-suite-to-runner inventory needed by later PRs.
    assertEquals(classifyTestPath("tests/integration/server/build.test.ts"), {
      kind: "canonical",
      path: "tests/integration/server/build.test.ts",
      level: "integration",
      suite: "integration",
      runner: "deno",
    });
    assertEquals(classifyTestPath("tests/e2e/smoke.playwright.ts"), {
      kind: "canonical",
      path: "tests/e2e/smoke.playwright.ts",
      level: "e2e",
      suite: "e2e",
      runner: "playwright",
    });
    assertEquals(classifyTestPath("tests/e2e/features/api-routes.test.ts"), {
      kind: "canonical",
      path: "tests/e2e/features/api-routes.test.ts",
      level: "e2e",
      suite: "e2e",
      runner: "deno",
    });
  });

  it("keeps current off-layout tests on explicit migration entries with owner and removal PR", () => {
    // Production break caught: a broad prefix/count allowlist can own new
    // off-layout tests without recording a finite path-level migration item.
    assertEquals(classifyTestPath("tests/unit/invalidation-state.test.ts"), {
      kind: "migration",
      path: "tests/unit/invalidation-state.test.ts",
      level: "unit",
      suite: "unit",
      runner: "deno",
      migrationEntry: {
        path: "tests/unit/invalidation-state.test.ts",
        owner: "test-architecture",
        removalPr: "PR 4",
      },
    });
    assertEquals(
      TEST_LAYOUT_MIGRATION_ENTRIES.every((entry) =>
        "path" in entry && "owner" in entry && "removalPr" in entry &&
        !("pathPrefix" in entry) && !("count" in entry)
      ),
      true,
    );
  });

  it("rejects executable fixtures and support files before migration ownership", () => {
    // Production break caught: tests/fixtures/leak.test.ts and
    // tests/**/support/leak.test.ts pass through the normal migration-enabled
    // classifier because a broad tests/ prefix owns them first.
    assertThrows(
      () => classifyTestPath("tests/fixtures/leak.test.ts"),
      Error,
      "support or fixture executable",
    );
    assertThrows(
      () => classifyTestPath("tests/integration/support/leak.test.ts"),
      Error,
      "support or fixture executable",
    );
    assertThrows(
      () => classifyTestPath("tests/support/leak.test.ts"),
      Error,
      "support or fixture executable",
    );
    assertThrows(
      () => classifyTestPath("tests/e2e/fixtures/leak.test.ts"),
      Error,
      "support or fixture executable",
    );
  });

  it("fails orphan tests and deliberate duplicate canonical owners", () => {
    // Production break caught: new executable paths can be added without one
    // owner, or with overlapping owners.
    assertThrows(
      () => classifyTestPath("packages/new-feature/example.test.ts"),
      Error,
      "no test layout owner",
    );
    assertThrows(
      () =>
        classifyTestPath("src/agent/overlap.test.ts", {
          suites: [
            {
              id: "unit",
              level: "unit",
              pathSelectors: ["src/"],
              runner: "deno",
              prOwner: "test-architecture",
              supportExclusions: [],
            },
            {
              id: "integration",
              level: "integration",
              pathSelectors: ["src/agent/"],
              runner: "deno",
              prOwner: "test-architecture",
              supportExclusions: [],
            },
          ],
          migrationEntries: [],
        }),
      Error,
      "multiple test layout owners",
    );
  });
});

describe("test layout inventory validation", () => {
  it("discovers tests in lexical order", async () => {
    // Production break caught: filesystem traversal order leaks into the
    // emitted inventory, causing unstable evidence and shard inputs.
    const result = await discoverTests({
      paths: [
        "src/zeta.test.ts",
        "src/alpha.test.ts",
        "tests/e2e/smoke.playwright.ts",
      ],
    });

    assertEquals(result.inventory.map((entry) => entry.path), [
      "src/alpha.test.ts",
      "src/zeta.test.ts",
      "tests/e2e/smoke.playwright.ts",
    ]);
  });

  it("shards test paths by stable hash independent of input order", () => {
    // Production break caught: sharding depends on caller or filesystem order
    // instead of a stable path hash.
    const paths = [
      "src/agent/factory.test.ts",
      "cli/router.test.ts",
      "tests/e2e/smoke.playwright.ts",
      "tests/integration/server/build.test.ts",
    ];

    assertEquals(
      shardTests(paths, 1, 2),
      shardTests([...paths].reverse(), 1, 2),
    );
    assertEquals(
      shardTests(paths, 2, 2),
      shardTests([...paths].reverse(), 2, 2),
    );
  });

  it("emits path to level to leaf suite to runner inventory", async () => {
    // Production break caught: validateTestLayout proves only aggregate counts
    // and cannot feed later suite-selection work from concrete ownership data.
    const result = await validateTestLayout({
      paths: [
        "tests/bun/runner-args.test.mjs",
        "src/agent/factory.test.ts",
        "tests/e2e/smoke.playwright.ts",
      ],
    });

    assertEquals(result.inventory, [
      {
        path: "src/agent/factory.test.ts",
        level: "unit",
        suite: "unit",
        runner: "deno",
        kind: "canonical",
      },
      {
        path: "tests/bun/runner-args.test.mjs",
        level: "unit",
        suite: "runtime",
        runner: "bun",
        variant: "bun",
        kind: "migration",
      },
      {
        path: "tests/e2e/smoke.playwright.ts",
        level: "e2e",
        suite: "e2e",
        runner: "playwright",
        kind: "canonical",
      },
    ]);
  });

  it("collects executable tests from the repo without vendored node_modules", async () => {
    // Production break caught: dependency tests under node_modules contaminate
    // the project inventory and hide real owner counts.
    const files = await collectExecutableTestFiles(".");

    assertEquals(files.includes("src/agent/factory.test.ts"), true);
    assertEquals(
      files.some((path) => path.startsWith("node_modules/")),
      false,
    );
  });

  it("rejects migration entries that no longer match a current violation", async () => {
    // Production break caught: deleted or canonicalized migration paths can stay
    // in the temporary inventory instead of forcing monotonic shrinkage.
    await assertRejects(
      () =>
        validateTestLayout({
          paths: ["src/agent/factory.test.ts"],
          migrationEntries: [{
            path: "tests/unit/invalidation-state.test.ts",
            level: "unit",
            suite: "unit",
            runner: "deno",
            owner: "test-architecture",
            removalPr: "PR 4",
          }],
        }),
      Error,
      "stale migration entry",
    );
  });

  it("rejects new migration paths even when a matching entry is added", () => {
    // Production break caught: a PR can grow the temporary migration inventory
    // by adding an off-layout test and a matching explicit migration entry.
    const errors = validateMigrationPathRatchet(
      [
        migrationEntry("tests/unit/invalidation-state.test.ts"),
        migrationEntry("tests/unit/new-off-layout.test.ts"),
      ],
      {
        kind: "paths",
        ref: "base-ref",
        paths: ["tests/unit/invalidation-state.test.ts"],
      },
    );

    assertEquals(errors, [
      "Test layout migration inventory grew relative to base-ref: tests/unit/new-off-layout.test.ts",
    ]);
  });

  it("allows migration path deletion relative to the baseline", () => {
    // Production break caught: a shrink-only ratchet blocks legitimate removal
    // of an explicit migration entry after a test moves to a canonical root.
    const errors = validateMigrationPathRatchet(
      [migrationEntry("tests/unit/invalidation-state.test.ts")],
      {
        kind: "paths",
        ref: "base-ref",
        paths: [
          "tests/unit/invalidation-state.test.ts",
          "tests/unit/rendering/layouts/components-layout-discovery.test.ts",
        ],
      },
    );

    assertEquals(errors, []);
  });

  it("allows initial migration inventory seeding when the base file is absent", () => {
    // Production break caught: the first taxonomy PR cannot introduce the
    // temporary inventory because the historical base has no migration file.
    const errors = validateMigrationPathRatchet(
      [migrationEntry("tests/unit/invalidation-state.test.ts")],
      { kind: "missing", ref: "base-ref" },
    );

    assertEquals(errors, []);
  });

  it("accepts a valid empty migration inventory after the final move", () => {
    const baseline = parseMigrationBaselineSource(
      `export const TEST_LAYOUT_MIGRATION_ENTRIES:
        readonly TestLayoutMigrationEntry[] = Object.freeze([]);`,
      "base-ref",
    );

    assertEquals(baseline, {
      kind: "paths",
      ref: "base-ref",
      paths: [],
    });
    assertEquals(
      validateMigrationPathRatchet([], baseline),
      [],
    );
  });

  it("extracts only paths from the checked-in migration export", async () => {
    const source = await Deno.readTextFile(
      new URL("./test-layout-migration.ts", import.meta.url),
    );

    assertEquals(
      parseMigrationBaselineSource(source, "base-ref"),
      {
        kind: "paths",
        ref: "base-ref",
        paths: TEST_LAYOUT_MIGRATION_ENTRIES.map((entry) => entry.path).sort(),
      },
    );
  });

  it("rejects quoted path decoys outside migration entries", () => {
    for (
      const decoy of [
        '// "tests/unit/invalidation-state.test.ts"',
        '/* "tests/unit/invalidation-state.test.ts" */',
        'const fixture = `"tests/unit/invalidation-state.test.ts"`;',
      ]
    ) {
      const baseline = parseMigrationBaselineSource(
        `${decoy}
        export const TEST_LAYOUT_MIGRATION_ENTRIES = Object.freeze([
          { pathPrefix: "tests/", count: 51 },
        ]);`,
        "base-ref",
      );

      assertEquals(baseline, {
        kind: "malformed",
        ref: "base-ref",
        reason:
          "base migration file has no explicit executable migration paths",
      });
    }
  });

  it("rejects non-code empty inventories that mask a malformed export", () => {
    for (
      const nonCodePrefix of [
        "// export const TEST_LAYOUT_MIGRATION_ENTRIES = Object.freeze([]);",
        `/*
        export const TEST_LAYOUT_MIGRATION_ENTRIES = Object.freeze([]);
        */`,
        `const fixture = \`
        export const TEST_LAYOUT_MIGRATION_ENTRIES = Object.freeze([]);
        \`;`,
      ]
    ) {
      const baseline = parseMigrationBaselineSource(
        `${nonCodePrefix}
        export const TEST_LAYOUT_MIGRATION_ENTRIES = Object.freeze([
          { pathPrefix: "tests/", count: 51 },
        ]);`,
        "base-ref",
      );

      assertEquals(baseline, {
        kind: "malformed",
        ref: "base-ref",
        reason:
          "base migration file has no explicit executable migration paths",
      });
    }
  });

  it("fails closed for malformed base migration evidence once the base file exists", () => {
    // Production break caught: an unsupported historical migration file shape
    // is treated as an empty baseline, silently permitting inventory growth.
    const baseline = parseMigrationBaselineSource(
      `export const TEST_LAYOUT_MIGRATION_ENTRIES = Object.freeze([
        { pathPrefix: "tests/", count: 51 },
      ]);`,
      "base-ref",
    );

    assertEquals(baseline, {
      kind: "malformed",
      ref: "base-ref",
      reason: "base migration file has no explicit executable migration paths",
    });
    assertEquals(
      validateMigrationPathRatchet(
        [migrationEntry("tests/unit/invalidation-state.test.ts")],
        baseline,
      ),
      [
        "Test layout migration baseline at base-ref is malformed: base migration file has no explicit executable migration paths",
      ],
    );
  });

  it("validates the current repository inventory", async () => {
    // Production break caught: the checked-in taxonomy does not classify the
    // current executable test tree end to end.
    const result = await validateTestLayout({ root: "." });

    assertEquals(result.errors, []);
    assertEquals(result.files > 0, true);
    assertEquals(result.inventory.length, result.files);
    assertEquals(result.timingMs >= 0, true);
  });
});

describe("test layout CI baseline", () => {
  it("fetches the remote branch name while retaining origin/main as the manual baseline", async () => {
    const workflow = await Deno.readTextFile(
      new URL("../../.github/workflows/cicd.yml", import.meta.url),
    );

    assertEquals(
      workflow.includes(
        '*) fetch_ref="main"; base="origin/main" ;;',
      ),
      true,
    );
    assertEquals(
      workflow.includes(
        'git fetch --no-tags --depth=1 origin "$fetch_ref"',
      ),
      true,
    );
  });
});

function migrationEntry(path: string): TestLayoutMigrationEntry {
  return {
    path,
    level: "unit",
    suite: "unit",
    runner: "deno",
    owner: "test-architecture",
    removalPr: "PR 4",
  };
}

async function writeFixture(root: string, relativePath: string): Promise<void> {
  const target = join(root, relativePath);
  await ensureDir(dirname(target));
  await Deno.writeTextFile(target, "");
}
