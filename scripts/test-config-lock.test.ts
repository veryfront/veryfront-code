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
    throw new Error("test:scripts must enforce its lockfile isolation contract");
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
