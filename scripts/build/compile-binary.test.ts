import { assertEquals } from "#std/assert";
import { walk } from "#std/fs/walk";
import {
  createCompileArgs,
  DEFAULT_INCLUDES,
  PROXY_INCLUDES,
} from "./compile-binary.ts";

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

Deno.test("proxy binary embeds only the runtime-resolved proxy entrypoint", async () => {
  const args = createCompileArgs({
    entrypoint: "cli/proxy-main.ts",
    extraIncludes: [],
    output: "/tmp/veryfront-proxy",
    profile: "proxy",
  });

  for (const include of PROXY_INCLUDES) {
    assertEquals(args.includes(include), true, `missing proxy include ${include}`);
  }

  assertEquals(args.includes("--node-modules-dir=none"), true);
  assertEquals(args.includes("scripts/build/proxy-deno.lock"), true);
  assertEquals(args.includes("--frozen"), true);
  assertEquals(args.includes("extensions/ext-image-sharp/src/index.ts"), false);
  assertEquals(args.includes("dist/framework-src"), false);
  assertEquals(args.at(-1), "cli/proxy-main.ts");

  const entrypoint = await Deno.readTextFile("cli/proxy-main.ts");
  for (
    const extension of [
      "ext-auth-jwt",
      "ext-cache-redis",
      "ext-redis",
      "ext-observability-opentelemetry",
      "ext-observability-sentry",
    ]
  ) {
    assertEquals(
      entrypoint.includes(`../extensions/${extension}/src/index.ts`),
      true,
      `proxy entrypoint must statically embed ${extension}`,
    );
  }

  const lock = JSON.parse(
    await Deno.readTextFile("scripts/build/proxy-deno.lock"),
  ) as { npm?: Record<string, unknown> };
  const packages = Object.keys(lock.npm ?? {});
  for (const unrelated of ["@huggingface/transformers", "esbuild", "sharp"]) {
    assertEquals(
      packages.some((name) => name === unrelated || name.startsWith(`${unrelated}@`)),
      false,
      `proxy lock must not contain ${unrelated}`,
    );
  }

});

Deno.test("full binary remains the default compile profile", () => {
  const args = createCompileArgs({
    entrypoint: "cli/main.ts",
    extraIncludes: [],
    output: "/tmp/veryfront",
  });

  assertEquals(args.includes("extensions/ext-image-sharp/src/index.ts"), true);
  assertEquals(args.includes("dist/framework-src"), true);
  assertEquals(args.includes("scripts/build/proxy-deno.lock"), false);
});
