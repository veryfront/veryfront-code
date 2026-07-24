import { assertEquals, assertNotEquals } from "#std/assert";
import { classifyCliFrameworkImport } from "./enforce-cli-boundary.ts";

Deno.test("CLI boundary allows only the exact private startup port", () => {
  assertEquals(
    classifyCliFrameworkImport("#veryfront/server-cli-startup"),
    null,
  );

  for (
    const specifier of [
      "#veryfront/server",
      "#veryfront/server/production-server.ts",
      "#veryfront/server-cli-startup/extra",
      "#veryfront/server-cli-startup.ts",
      "#veryfront/server-cli-startup?unsafe=1",
      "#veryfront/config",
    ]
  ) {
    assertNotEquals(
      classifyCliFrameworkImport(specifier),
      null,
      `${specifier} must remain forbidden`,
    );
  }
});

Deno.test("CLI boundary continues to allow public and local CLI imports", () => {
  for (
    const specifier of [
      "veryfront/server",
      "veryfront/platform",
      "#cli/commands/files/command",
      "./startup-env.ts",
    ]
  ) {
    assertEquals(classifyCliFrameworkImport(specifier), null);
  }
});

Deno.test("private startup port is import-mapped but not package-exported", async () => {
  const config = JSON.parse(
    await Deno.readTextFile(new URL("../../deno.json", import.meta.url)),
  ) as {
    imports?: Record<string, string>;
    exports?: Record<string, string>;
  };

  assertEquals(
    config.imports?.["#veryfront/server-cli-startup"],
    "./src/server/cli-startup.ts",
  );
  assertEquals(config.exports?.["./server-cli-startup"], undefined);
  assertEquals(
    Object.values(config.exports ?? {}).includes(
      "./src/server/cli-startup.ts",
    ),
    false,
  );
});
