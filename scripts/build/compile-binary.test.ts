import { assertEquals } from "#std/assert";
import { walk } from "#std/fs/walk";
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

Deno.test("compiled CLI embeds every runtime-resolved sibling module", async () => {
  // Modules picked through a `.ts`/`.js` distribution-format ternary are
  // resolved from a computed URL, so `deno compile` never sees them in the
  // static graph and only DEFAULT_INCLUDES can embed them.
  const siblingTernary = /"\.\/([^"]+)\.ts"\s*:\s*"\.\/\1\.js"/g;
  let asserted = 0;

  for await (
    const entry of walk("extensions", {
      exts: [".ts", ".tsx"],
      includeDirs: false,
    })
  ) {
    if (entry.path.includes(".test.")) continue;
    const source = await Deno.readTextFile(entry.path);
    const directory = entry.path.slice(0, entry.path.lastIndexOf("/"));

    for (const match of source.matchAll(siblingTernary)) {
      const include = `${directory}/${match[1]!}.ts`;
      assertEquals(
        DEFAULT_INCLUDES.includes(include),
        true,
        `compile-binary DEFAULT_INCLUDES must embed ${include}, resolved at runtime by ${entry.path}`,
      );
      asserted += 1;
    }
  }

  // Guard against the walk silently matching nothing and passing vacuously.
  assertEquals(
    asserted >= 3,
    true,
    `expected runtime-resolved siblings, found ${asserted}`,
  );
});

Deno.test("compiled CLI embeds the permissionless parser entry", () => {
  assertEquals(
    DEFAULT_INCLUDES.includes(
      "extensions/ext-parser-babel/src/parser-only.ts",
    ),
    true,
  );
});

Deno.test("compiled CLI embeds the auto-loaded Sentry reporter", () => {
  assertEquals(
    DEFAULT_INCLUDES.includes(
      "extensions/ext-observability-sentry/src/index.ts",
    ),
    true,
  );
});
