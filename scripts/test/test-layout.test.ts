import { assertEquals, assertRejects, assertThrows } from "#std/assert";
import { describe, it } from "#std/testing/bdd";
import {
  classifyTestPath,
  collectExecutableTestFiles,
  getExecutableTestKind,
  validateTestLayout,
} from "./test-layout.ts";

describe("test path executable classification", () => {
  it("accepts every supported executable test extension and Playwright name", () => {
    // Production break caught: a supported runner file can be orphaned because
    // the executable detector forgets one extension or Playwright pattern.
    assertEquals(getExecutableTestKind("tests/unit/example.test.ts"), "deno");
    assertEquals(getExecutableTestKind("tests/unit/example.test.tsx"), "deno");
    assertEquals(getExecutableTestKind("tests/unit/example.test.js"), "deno");
    assertEquals(getExecutableTestKind("tests/unit/example.test.mjs"), "deno");
    assertEquals(getExecutableTestKind("tests/unit/example.test.cjs"), "deno");
    assertEquals(
      getExecutableTestKind("tests/e2e/example.playwright.ts"),
      "playwright",
    );
  });

  it("rejects support files, fixtures, and unsupported extensions", () => {
    // Production break caught: helper fixtures or unsupported executable names
    // are treated as runnable suites and get assigned an owner.
    assertEquals(getExecutableTestKind("tests/_helpers/server.ts"), undefined);
    assertEquals(
      getExecutableTestKind("tests/fixtures/test-data-factory.ts"),
      undefined,
    );
    assertEquals(
      getExecutableTestKind("tests/unit/example.test.md"),
      undefined,
    );
    assertThrows(
      () => classifyTestPath("tests/unit/example.test.md"),
      Error,
      "Unsupported or non-executable test path",
    );
  });
});

describe("test layout path ownership", () => {
  it("classifies every valid canonical location into level, leaf suite, and runner", () => {
    // Production break caught: canonical test directories can resolve to the
    // wrong level, suite, variant, or runner.
    assertEquals(classifyTestPath("tests/unit/rendering/layout.test.ts"), {
      kind: "canonical",
      path: "tests/unit/rendering/layout.test.ts",
      level: "unit",
      suite: "unit",
      runner: "deno",
    });
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
    assertEquals(classifyTestPath("tests/node/loader.test.mjs"), {
      kind: "canonical",
      path: "tests/node/loader.test.mjs",
      level: "runtime",
      suite: "runtime",
      variant: "node",
      runner: "node",
    });
    assertEquals(classifyTestPath("tests/bun/runner-args.test.mjs"), {
      kind: "canonical",
      path: "tests/bun/runner-args.test.mjs",
      level: "runtime",
      suite: "runtime",
      variant: "bun",
      runner: "bun",
    });
    assertEquals(classifyTestPath("scripts/test/test-layout.test.ts"), {
      kind: "canonical",
      path: "scripts/test/test-layout.test.ts",
      level: "tooling",
      suite: "scripts",
      runner: "deno",
    });
  });

  it("keeps current off-layout tests on a finite migration entry", () => {
    // Production break caught: taxonomy-only migration starts moving ownership
    // rules into runner selection or loses the temporary migration owner.
    assertEquals(classifyTestPath("src/agent/factory.test.ts"), {
      kind: "migration",
      path: "src/agent/factory.test.ts",
      level: "unit",
      suite: "unit",
      runner: "deno",
      migrationEntry: "src",
    });
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
        classifyTestPath("tests/unit/overlap.test.ts", {
          suites: [
            {
              id: "unit",
              level: "unit",
              pathPrefix: "tests/unit/",
              runner: "deno",
            },
            {
              id: "unit",
              level: "unit",
              pathPrefix: "tests/unit/overlap",
              runner: "deno",
            },
          ],
          migrationEntries: [],
        }),
      Error,
      "multiple test layout owners",
    );
  });

  it("rejects executable support and fixture tests outside canonical ownership", () => {
    // Production break caught: a support fixture named like a test becomes a
    // runnable suite instead of failing loudly.
    assertThrows(
      () =>
        classifyTestPath("tests/_helpers/playwright.test.ts", {
          migrationEntries: [],
        }),
      Error,
      "support or fixture executable",
    );
  });
});

describe("test layout inventory validation", () => {
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

  it("rejects migration allowlist growth against real filesystem behavior", async () => {
    // Production break caught: adding a test under a migrated prefix silently
    // grows the temporary inventory instead of forcing an explicit decision.
    await assertRejects(
      () =>
        validateTestLayout({
          root: ".",
          migrationEntries: [{
            id: "src",
            pathPrefix: "src/",
            count: 1,
            level: "unit",
            suite: "unit",
            runner: "deno",
          }],
        }),
      Error,
      "migration allowlist count changed",
    );
  });

  it("validates the current repository inventory", async () => {
    // Production break caught: the checked-in taxonomy does not classify the
    // current executable test tree end to end.
    const result = await validateTestLayout({ root: "." });

    assertEquals(result.errors, []);
    assertEquals(result.files > 0, true);
    assertEquals(result.timingMs >= 0, true);
  });
});
