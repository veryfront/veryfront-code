import { assertEquals } from "#std/assert";
import { createCompileArgs, DEFAULT_INCLUDES } from "./compile-binary.ts";

Deno.test("compiled CLI does not implicitly embed CSS extensions or remote plugin bundles", () => {
  const args = createCompileArgs({
    entrypoint: "cli/main.ts",
    extraIncludes: [],
    output: "/tmp/veryfront",
  });

  assertEquals(
    args.some((value) => value.includes("extensions/ext-css-")),
    false,
  );
  assertEquals(args.some((value) => /^https?:\/\//.test(value)), false);
});

Deno.test("compiled CLI does not implicitly embed Redis extensions", () => {
  const args = createCompileArgs({
    entrypoint: "cli/main.ts",
    extraIncludes: [],
    output: "/tmp/veryfront",
  });

  assertEquals(
    args.some((value) =>
      value.includes("ext-cache-redis") || value.includes("ext-redis")
    ),
    false,
  );
});

Deno.test("compiled CLI does not implicitly embed the explicit Node WebSocket extension", () => {
  const args = createCompileArgs({
    entrypoint: "cli/main.ts",
    extraIncludes: [],
    output: "/tmp/veryfront",
  });

  assertEquals(
    args.some((value) => value.includes("ext-node-websocket-ws")),
    false,
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

Deno.test("compiled CLI embeds the Worker-safe Babel parser entry", () => {
  assertEquals(
    DEFAULT_INCLUDES.includes(
      "extensions/ext-parser-babel/src/parser-only.ts",
    ),
    true,
  );
});

Deno.test("compiled CLI embeds the first-party Skill YAML parser", () => {
  assertEquals(
    DEFAULT_INCLUDES.includes(
      "extensions/ext-yaml/src/index.ts",
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

Deno.test("compiled CLI embeds the declarative evaluator worker entry", () => {
  assertEquals(
    DEFAULT_INCLUDES.includes(
      "src/config/declarative-evaluator-worker-entry.ts",
    ),
    true,
    "compile-binary DEFAULT_INCLUDES must embed the URL-loaded declarative evaluator worker",
  );
});
