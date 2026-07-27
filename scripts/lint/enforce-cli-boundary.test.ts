import { assertEquals, assertNotEquals } from "#std/assert";
import { classifyCliFrameworkImport } from "./enforce-cli-boundary.ts";

Deno.test("CLI boundary allows only the exact private server ports", () => {
  for (
    const specifier of [
      "#veryfront/server-cli-domain",
      "#veryfront/server-cli-startup",
    ]
  ) {
    assertEquals(classifyCliFrameworkImport(specifier), null);
  }

  for (
    const specifier of [
      "#veryfront/server",
      "#veryfront/server/production-server.ts",
      "#veryfront/server-cli-domain/extra",
      "#veryfront/server-cli-domain.ts",
      "#veryfront/server-cli-domain?unsafe=1",
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

Deno.test("private server ports are import-mapped but not package-exported", async () => {
  const config = JSON.parse(
    await Deno.readTextFile(new URL("../../deno.json", import.meta.url)),
  ) as {
    imports?: Record<string, string>;
    exports?: Record<string, string>;
  };

  for (
    const [specifier, target] of [
      ["#veryfront/server-cli-domain", "./src/server/cli-domain.ts"],
      ["#veryfront/server-cli-startup", "./src/server/cli-startup.ts"],
    ] as const
  ) {
    assertEquals(config.imports?.[specifier], target);
    assertEquals(
      config.exports?.[`./${specifier.slice("#veryfront/".length)}`],
      undefined,
    );
    assertEquals(Object.values(config.exports ?? {}).includes(target), false);
  }
});
