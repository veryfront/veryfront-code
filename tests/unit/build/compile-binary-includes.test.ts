import "../../_helpers/contract-init.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createCompileArgs,
  UNTRACEABLE_WORKER_INCLUDES,
} from "../../../scripts/build/compile-binary.ts";

describe("compile-binary includes", () => {
  function getIncludeFlags(profile: "full" | "proxy" = "full"): string[] {
    const args = createCompileArgs({
      entrypoint: profile === "proxy" ? "cli/proxy-main.ts" : "cli/main.ts",
      extraIncludes: [],
      output: "/tmp/test-veryfront",
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

  it("should embed the untraceable worker entrypoints in the full profile", () => {
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
    // Not an accident worth "fixing": embedding these drags the declarative
    // evaluator's babel tree into scripts/build/proxy-deno.lock, which --frozen
    // rejects, so the proxy binary fails to build. If the proxy ever needs to
    // spawn one, the lock has to be regenerated in the same change.
    const includeFlags = getIncludeFlags("proxy");
    for (const workerInclude of UNTRACEABLE_WORKER_INCLUDES) {
      assertEquals(
        includeFlags.includes(workerInclude),
        false,
        `${workerInclude} in the proxy profile breaks the frozen proxy lock; regenerate scripts/build/proxy-deno.lock in the same change`,
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
