import { assertEquals, assertStringIncludes } from "#std/assert";

function commandHasToken(command: string, token: string): boolean {
  return command.split(/\s+/).includes(token);
}

function permissionFlags(command: string): string[] {
  return command.split(/\s+/).filter((token) => token.startsWith("--allow-"));
}

Deno.test("script tooling uses an isolated frozen lockfile", async () => {
  const scriptConfig = JSON.parse(
    await Deno.readTextFile("scripts/test.deno.json"),
  ) as { lock?: string };
  const rootConfig = JSON.parse(await Deno.readTextFile("deno.json")) as {
    tasks?: Record<string, string>;
  };

  assertEquals(scriptConfig.lock, "./deno.lock");

  const scriptTests = rootConfig.tasks?.["test:scripts"] ?? "";
  assertStringIncludes(scriptTests, "--config=scripts/test.deno.json");
  assertStringIncludes(scriptTests, "--frozen");
  assertStringIncludes(scriptTests, "scripts/test-config-lock.test.ts");

  assertEquals(
    rootConfig.tasks?.["lint:core-deps"],
    "deno run --config=scripts/test.deno.json --frozen --allow-read scripts/lint/audit-core-deps.ts",
  );

  const strictAudit = rootConfig.tasks?.["lint:core-deps:strict"] ?? "";
  assertEquals(
    strictAudit,
    "deno run --config=scripts/test.deno.json --frozen --allow-read --allow-write scripts/lint/audit-core-deps-strict.ts --output .veryfront/audits/core-deps-strict.json",
  );
  assertEquals(permissionFlags(strictAudit), ["--allow-read", "--allow-write"]);
});

Deno.test("governance scripts have explicit isolated lint, format, check, and test owners", async () => {
  const rootConfig = JSON.parse(await Deno.readTextFile("deno.json")) as {
    tasks: Record<string, string>;
  };
  const governedCodePaths = [
    "scripts/test-config-lock.test.ts",
    "scripts/lib/path-containment.ts",
    "scripts/lib/path-containment.test.ts",
    "scripts/lint/source-import-collector.ts",
    "scripts/lint/source-import-collector.test.ts",
    "scripts/lint/core-production-roots.ts",
    "scripts/lint/core-production-roots.test.ts",
    "scripts/lint/audit-core-deps.ts",
    "scripts/lint/audit-core-deps.test.ts",
    "scripts/lint/audit-core-deps-strict.ts",
    "scripts/lint/audit-core-deps-strict.test.ts",
    "scripts/build/browser-safe-exports.mjs",
    "scripts/build/browser-safe-exports.test.ts",
    "scripts/build/npm-package-metadata.ts",
    "scripts/build/npm-package-metadata.test.ts",
    "scripts/build/build-npm-dnt.ts",
  ];

  for (
    const taskName of [
      "lint:scripts:core-deps",
      "fmt:scripts:core-deps",
      "fmt:scripts:core-deps:check",
      "check:scripts:core-deps",
    ]
  ) {
    const task = rootConfig.tasks[taskName] ?? "";
    assertStringIncludes(task, "--config=scripts/test.deno.json");
    for (const path of governedCodePaths) {
      if (!commandHasToken(task, path)) {
        throw new Error(`${taskName} does not own ${path}`);
      }
    }
  }

  for (
    const taskName of [
      "fmt:scripts:core-deps",
      "fmt:scripts:core-deps:check",
    ]
  ) {
    if (
      !commandHasToken(
        rootConfig.tasks[taskName] ?? "",
        "scripts/test.deno.json",
      )
    ) {
      throw new Error(`${taskName} does not own scripts/test.deno.json`);
    }
  }

  for (const taskName of ["check:scripts:core-deps", "test:scripts"]) {
    assertStringIncludes(rootConfig.tasks[taskName] ?? "", "--frozen");
  }
  const scriptTests = rootConfig.tasks["test:scripts"] ?? "";
  for (
    const path of [
      "scripts/test-config-lock.test.ts",
      "scripts/build/browser-safe-exports.test.ts",
      "scripts/build/npm-package-metadata.test.ts",
      "scripts/lib/path-containment.test.ts",
      "scripts/lint/source-import-collector.test.ts",
      "scripts/lint/core-production-roots.test.ts",
      "scripts/lint/audit-core-deps.test.ts",
      "scripts/lint/audit-core-deps-strict.test.ts",
    ]
  ) {
    if (!commandHasToken(scriptTests, path)) {
      throw new Error(`test:scripts does not own ${path}`);
    }
  }
  assertStringIncludes(scriptTests, "deno task check:scripts:core-deps");
});

Deno.test("aggregate gates include governance checks without promoting the expected-red strict audit", async () => {
  const config = JSON.parse(await Deno.readTextFile("deno.json")) as {
    tasks: Record<string, string>;
  };
  assertStringIncludes(
    config.tasks.lint ?? "",
    "deno task lint:scripts:core-deps",
  );
  assertStringIncludes(
    config.tasks.fmt ?? "",
    "deno task fmt:scripts:core-deps",
  );
  assertStringIncludes(
    config.tasks["fmt:check"] ?? "",
    "deno task fmt:scripts:core-deps:check",
  );
  assertStringIncludes(
    config.tasks.typecheck ?? "",
    "deno task check:scripts:core-deps",
  );
  for (const taskName of ["verify", "verify:quick"]) {
    assertStringIncludes(
      config.tasks[taskName] ?? "",
      "deno task lint:core-deps",
    );
    assertEquals(
      (config.tasks[taskName] ?? "").includes("lint:core-deps:strict"),
      false,
    );
  }
});
