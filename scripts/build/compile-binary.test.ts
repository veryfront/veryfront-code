import { assertEquals } from "#std/assert";
import { walk } from "#std/fs/walk";
import { createCompileArgs, DEFAULT_INCLUDES } from "./compile-binary.ts";
import { FIRST_PARTY_BUILTIN_EXTENSION_POLICIES } from "../../src/extensions/first-party-defaults.ts";

Deno.test("compiled CLI embeds the default Node WebSocket extension for HMR", () => {
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
  for (const { sourceDirectory } of FIRST_PARTY_BUILTIN_EXTENSION_POLICIES) {
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
  const runtimeResolvedIncludes: string[] = [];

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
      runtimeResolvedIncludes.push(include);
    }
  }

  assertEquals(
    runtimeResolvedIncludes.sort(),
    [
      "extensions/ext-document-kreuzberg/src/native-progress-extraction-worker.ts",
      "extensions/ext-document-kreuzberg/src/upload-extraction-worker.ts",
      "extensions/ext-react-ssr/src/worker-renderer.ts",
    ],
    "runtime-resolved sibling inventory changed; update DEFAULT_INCLUDES and this explicit contract together",
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
