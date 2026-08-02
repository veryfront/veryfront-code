import { assertEquals } from "#std/assert";
import { createCompileArgs, DEFAULT_INCLUDES } from "./compile-binary.ts";

Deno.test("compiled CLI embeds the explicit Node WebSocket extension for opt-in activation", () => {
  const args = createCompileArgs({
    entrypoint: "cli/main.ts",
    extraIncludes: [],
    output: "/tmp/veryfront",
  });

  assertEquals(
    args.some((value) => value.includes("ext-node-websocket-ws")),
    true,
  );
});

Deno.test("compiled CLI embeds the explicit Redis extension for opt-in activation", () => {
  const args = createCompileArgs({
    entrypoint: "cli/main.ts",
    extraIncludes: [],
    output: "/tmp/veryfront",
  });

  assertEquals(
    args.some((value) => value.includes("ext-redis")),
    true,
  );
});

Deno.test("compiled CLI embeds optional builtin extension source files", async () => {
  const source = await Deno.readTextFile(
    "src/extensions/builtin-extensions.ts",
  );
  const sourceDirectories = Array.from(
    source.matchAll(/sourceDirectory:\s*"([^"]+)"/g),
    (match) => match[1]!,
  );

  for (const sourceDirectory of sourceDirectories) {
    assertEquals(
      DEFAULT_INCLUDES.includes(`extensions/${sourceDirectory}/src/index.ts`),
      true,
      `compile-binary DEFAULT_INCLUDES must embed optional builtin ${sourceDirectory}`,
    );
  }
});

Deno.test("compiled CLI embeds the auto-loaded Sentry reporter", () => {
  assertEquals(
    DEFAULT_INCLUDES.includes(
      "extensions/ext-observability-sentry/src/index.ts",
    ),
    true,
  );
});
