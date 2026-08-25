import "../../_helpers/contract-init.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createCompileArgs,
  findMissingEmbeddedWorkers,
  UNTRACEABLE_WORKER_INCLUDES,
} from "../../../scripts/build/compile-binary.ts";

describe("compile-binary includes", () => {
  function getIncludeFlags(profile: "full" | "proxy" = "full"): string[] {
    const args = createCompileArgs({
      entrypoint: profile === "proxy" ? "cli/proxy-main.ts" : "cli/main.ts",
      extraIncludes: [],
      output: "test-veryfront",
      profile,
    });

    const includeFlags: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const nextArg = args[i + 1];
      if (args[i] === "--include" && typeof nextArg === "string") {
        includeFlags.push(nextArg);
      }
    }

    return includeFlags;
  }

  it("should detect a worker entry missing from a compiled binary", () => {
    // The include-list tests all answer "did we ask for this?". The binary that
    // crash-looped production would pass every one of them. This answers "did it
    // ship?", which is the only question whose answer differed.
    const embedded = '{"File":{"n":"declarative-evaluator-worker-entry.ts","o":[1,2]}}';
    assertEquals(
      findMissingEmbeddedWorkers(embedded, ["src/config/declarative-evaluator-worker-entry.ts"]),
      [],
    );
    assertEquals(
      findMissingEmbeddedWorkers("", ["src/config/declarative-evaluator-worker-entry.ts"]),
      ["src/config/declarative-evaluator-worker-entry.ts"],
    );
  });

  it("should not accept the framework-src data asset as an embedded worker", () => {
    // dist/framework-src ships the same source renamed `.ts.src` so compile
    // treats it as data, not a module. A broken binary therefore still contains
    // the worker's body and its `.src` name. Only the exact VFS entry
    // discriminates, so the trailing quote in the marker is load-bearing.
    const brokenBinary =
      '{"File":{"n":"declarative-evaluator-worker-entry.ts.src","o":[1,2]}} evaluateRequest';
    assertEquals(
      findMissingEmbeddedWorkers(brokenBinary, [
        "src/config/declarative-evaluator-worker-entry.ts",
      ]),
      ["src/config/declarative-evaluator-worker-entry.ts"],
    );
  });

  it("should embed the untraceable worker entrypoints in the full profile", () => {
    // Wiring check on the `...UNTRACEABLE_WORKER_INCLUDES` spread, not the real
    // protection -- iterating the constant makes an empty constant vacuously
    // green. The two discovery tests below are what actually guard the class,
    // so assert the constant is populated before trusting this.
    assertEquals(
      UNTRACEABLE_WORKER_INCLUDES.length > 0,
      true,
      "UNTRACEABLE_WORKER_INCLUDES is empty, which makes this test vacuous",
    );
    const includeFlags = getIncludeFlags("full");
    for (const workerInclude of UNTRACEABLE_WORKER_INCLUDES) {
      assertEquals(
        includeFlags.includes(workerInclude),
        true,
        `${workerInclude} must be embedded in the full profile, got includes: ${
          JSON.stringify(includeFlags)
        }`,
      );
    }
  });

  it("should keep untraceable workers out of the frozen proxy profile", () => {
    // Pins a build constraint, not a safety claim. Embedding these fails the
    // proxy compile: the worker entry's graph wants a newer @babel/types than
    // proxy-deno.lock pins, and --frozen refuses to update it. The lock does
    // carry a babel toolchain already, so this says nothing about whether the
    // proxy can reach a worker spawn -- that question is tracked separately.
    // Regenerate the lock in the same change if the answer turns out to be yes.
    assertEquals(
      UNTRACEABLE_WORKER_INCLUDES.length > 0,
      true,
      "UNTRACEABLE_WORKER_INCLUDES is empty, which makes this test vacuous",
    );
    const includeFlags = getIncludeFlags("proxy");
    for (const workerInclude of UNTRACEABLE_WORKER_INCLUDES) {
      assertEquals(
        includeFlags.includes(workerInclude),
        false,
        `${workerInclude} in the proxy profile breaks the frozen proxy lock; regenerate scripts/build/proxy-deno.lock in the same change`,
      );
    }
  });

  it("should include every worker entrypoint named as one", async () => {
    // Complements the call-site scan below, which finds workers by how they are
    // spawned and so misses an entrypoint that exists but is not yet wired to a
    // `new Worker(...)` the scan recognises. This finds them by name instead, so
    // the two together cover both a worker the code spawns and a worker the
    // repo merely contains.
    const projectRoot = new URL("../../../", import.meta.url);
    const entrypointName = /-worker-entry\.ts$|(?:^|-)worker-script\.ts$/;

    const workerEntrypoints: string[] = [];
    async function collect(dir: string): Promise<void> {
      for await (const entry of Deno.readDir(new URL(dir, projectRoot))) {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory) {
          if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
          await collect(path);
        } else if (entry.name.endsWith(".ts") && entrypointName.test(entry.name)) {
          workerEntrypoints.push(path);
        }
      }
    }
    await collect("src");

    assertEquals(
      workerEntrypoints.length > 0,
      true,
      "expected to discover at least one worker entrypoint under src",
    );

    const includeFlags = getIncludeFlags("full");
    for (const entrypoint of workerEntrypoints) {
      assertEquals(
        includeFlags.some((path) => entrypoint === path || entrypoint.startsWith(`${path}/`)),
        true,
        `${entrypoint} must be in compile-binary.ts DEFAULT_INCLUDES; deno compile cannot trace the computed worker URL, so the binary crashes when the worker is spawned`,
      );
    }
  });

  it("should include every worker entrypoint spawned from a sibling URL", async () => {
    // `deno compile` embeds a worker only when it can statically read the
    // specifier. Every worker here resolves one relative to `import.meta.url`,
    // and two of them compute the extension, so none are traceable. A missing
    // entry does not fail the build or any test that runs from source: the
    // binary starts, serves traffic, and dies on the first request that spawns
    // the worker. That is how the declarative config evaluator reached
    // production and crash-looped it.
    const projectRoot = new URL("../../../", import.meta.url);
    const siblingWorkerSpecifier = /["'`](\.\/[^"'`\n]*[Ww]orker[^"'`\n]*)["'`]/g;

    async function* sourceFiles(dir: string): AsyncGenerator<string> {
      for await (const entry of Deno.readDir(new URL(dir, projectRoot))) {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory) {
          if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
          yield* sourceFiles(path);
        } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
          yield path;
        }
      }
    }

    const includeFlags = getIncludeFlags();
    const isCovered = (path: string) =>
      includeFlags.some((include) => path === include || path.startsWith(`${include}/`));

    const uncovered: string[] = [];
    for (const root of ["src", "extensions"]) {
      for await (const file of sourceFiles(root)) {
        const source = await Deno.readTextFile(new URL(file, projectRoot));
        // Only files that actually construct a Worker; a sibling URL elsewhere
        // is not a worker entrypoint and does not need embedding.
        if (!source.includes("new Worker(")) continue;

        for (const match of source.matchAll(siblingWorkerSpecifier)) {
          const specifier = match[1] ?? "";
          // A static `import`/`export ... from` specifier is traced by compile
          // and needs no include. Only a specifier reached some other way --
          // assigned to a variable, or built inline for `new URL` -- is opaque.
          if (/(?:from|import)\s*\(?\s*$/.test(source.slice(0, match.index))) continue;
          // Normalise `./name${extension}` and `./name.js` to the `.ts` source.
          const entry = specifier
            .replace(/\$\{[^}]*\}/g, "")
            .replace(/\.(?:ts|js)$/, "");
          const resolved = `${file.slice(0, file.lastIndexOf("/"))}/${entry.slice(2)}.ts`;
          if (!isCovered(resolved)) uncovered.push(`${file} -> ${resolved}`);
        }
      }
    }

    assertEquals(
      uncovered,
      [],
      `Worker entrypoints spawned via a sibling URL must be listed in compile-binary.ts DEFAULT_INCLUDES, or they are absent from the compiled binary and crash it at runtime:\n${
        uncovered.join("\n")
      }`,
    );
  });

  it("should include src/rendering/rsc for client hydration scripts", () => {
    // Regression: client-boot.ts and client-dom.ts must be embedded in the
    // compiled binary, otherwise RSC hydration fails with
    // "path not found: readfile '.../src/rendering/rsc/client-boot.ts'"
    const includeFlags = getIncludeFlags();

    const hasRscRendering = includeFlags.some((p) => p.includes("rendering/rsc"));
    assertEquals(
      hasRscRendering,
      true,
      `Expected --include flag for src/rendering/rsc, got includes: ${
        JSON.stringify(includeFlags)
      }`,
    );
  });

  it("should include only extension runtime files for compiled binaries", () => {
    const includeFlags = getIncludeFlags();
    const extensionIncludes = includeFlags.filter((path) => path.startsWith("extensions/"));

    assertEquals(
      extensionIncludes.some((path) => /(?:^|\/)[^/]+\.test\.ts$/.test(path)),
      false,
      `Expected no extension test files in binary includes, got includes: ${
        JSON.stringify(extensionIncludes)
      }`,
    );
    assertEquals(
      extensionIncludes.some((path) => path.endsWith("/src")),
      false,
      `Expected extension entrypoint files instead of source directories, got includes: ${
        JSON.stringify(extensionIncludes)
      }`,
    );
    assertEquals(extensionIncludes.includes("extensions/ext-content-mdx/src/index.ts"), true);
    assertEquals(
      extensionIncludes.includes(
        "extensions/ext-document-kreuzberg/src/upload-extraction-worker.ts",
      ),
      true,
    );
    assertEquals(
      extensionIncludes.includes(
        "extensions/ext-document-kreuzberg/src/native-progress-extraction-worker.ts",
      ),
      true,
    );
  });

  it("should include every workspace extension entrypoint", async () => {
    // The include list is hardcoded in compile-binary.ts. A workspace extension
    // missing from it ships in npm packages but silently disappears from
    // compiled binaries: the dynamic source import fails, the npm-package
    // fallback cannot succeed inside a binary, and the optional-builtin loader
    // downgrades the miss to a debug log.
    const denoConfig = JSON.parse(await Deno.readTextFile("deno.json")) as {
      workspace?: string[];
    };
    const workspaceExtensions = (denoConfig.workspace ?? [])
      .filter((entry) => entry.startsWith("./extensions/"))
      .map((entry) => entry.replace(/^\.\//, ""));
    assertEquals(workspaceExtensions.length > 0, true, "expected workspace extensions");

    // Statically imported by src/extensions/builtin-extensions.ts, so
    // `deno compile` traces them without an explicit --include.
    const staticallyTracedExtensions = new Set([
      "extensions/ext-schema-zod",
      "extensions/ext-llm-openai",
      "extensions/ext-llm-anthropic",
      "extensions/ext-llm-google",
    ]);

    const includeFlags = getIncludeFlags();
    for (const extensionDir of workspaceExtensions) {
      if (staticallyTracedExtensions.has(extensionDir)) continue;

      const manifest = JSON.parse(
        await Deno.readTextFile(`${extensionDir}/deno.json`),
      ) as { veryfront?: { extension?: boolean } };
      if (manifest.veryfront?.extension !== true) continue;

      assertEquals(
        includeFlags.includes(`${extensionDir}/src/index.ts`),
        true,
        `${extensionDir}/src/index.ts must be in compile-binary.ts DEFAULT_INCLUDES or the extension silently disappears from compiled binaries`,
      );
    }
  });
});
