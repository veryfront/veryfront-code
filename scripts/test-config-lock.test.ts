import { assertEquals, assertStringIncludes } from "#std/assert";

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
});
