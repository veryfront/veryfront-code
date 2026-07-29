Deno.test("script tooling uses an isolated lockfile", async () => {
  const config = JSON.parse(
    await Deno.readTextFile("scripts/test.deno.json"),
  ) as { readonly lock?: string };
  const rootConfig = JSON.parse(
    await Deno.readTextFile("deno.json"),
  ) as { readonly tasks?: Record<string, string> };

  if (config.lock !== "./deno.lock") {
    throw new Error(
      "scripts/test.deno.json must not mutate the root dependency lockfile",
    );
  }

  const scriptsTask = rootConfig.tasks?.["test:scripts"] ?? "";
  if (!scriptsTask.includes("--frozen")) {
    throw new Error("test:scripts must reject changes to the scripts lockfile");
  }
  if (!scriptsTask.includes("scripts/test-config-lock.test.ts")) {
    throw new Error(
      "test:scripts must enforce its lockfile isolation contract",
    );
  }
  if (!scriptsTask.includes("scripts/build/framework-candidates.test.ts")) {
    throw new Error(
      "test:scripts must run the framework candidate regression suite",
    );
  }
  if (!scriptsTask.includes("deno task check:scripts:framework-candidates")) {
    throw new Error(
      "test:scripts must type-check the framework candidate import graph",
    );
  }

  const frameworkCandidateCheck =
    rootConfig.tasks?.["check:scripts:framework-candidates"] ?? "";
  if (
    !frameworkCandidateCheck.includes("--config=scripts/test.deno.json") ||
    !frameworkCandidateCheck.includes("--frozen") ||
    !frameworkCandidateCheck.includes(
      "scripts/build/framework-candidates.ts",
    ) ||
    !frameworkCandidateCheck.includes(
      "scripts/build/framework-candidates.test.ts",
    )
  ) {
    throw new Error(
      "framework candidate scripts must type-check against the frozen scripts configuration",
    );
  }

  const generatedFrameworkCandidateCheck =
    rootConfig.tasks?.["generate:framework-candidates:check"] ?? "";
  if (!generatedFrameworkCandidateCheck.includes("--frozen")) {
    throw new Error(
      "generate:framework-candidates:check must reject root lockfile drift",
    );
  }

  const templateFormatCheck = rootConfig.tasks?.["fmt:templates:check"] ?? "";
  if (
    !templateFormatCheck.includes("--check") ||
    !templateFormatCheck.includes("--config=cli/templates/deno.json")
  ) {
    throw new Error(
      "fmt:templates:check must enforce the isolated template formatter configuration",
    );
  }

  const rootFormatCheck = rootConfig.tasks?.["fmt:check"] ?? "";
  if (!rootFormatCheck.includes("deno task fmt:templates:check")) {
    throw new Error(
      "fmt:check must include the production template source formatter gate",
    );
  }

  const npmBuildTask = rootConfig.tasks?.["build:npm"] ?? "";
  if (
    !npmBuildTask.includes("--config=scripts/test.deno.json") ||
    !npmBuildTask.includes("--frozen")
  ) {
    throw new Error(
      "build:npm must resolve build-only dependencies from the frozen scripts lockfile",
    );
  }
});
