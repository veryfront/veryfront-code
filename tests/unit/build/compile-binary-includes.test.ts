import "../../_helpers/contract-init.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createCompileArgs } from "../../../scripts/build/compile-binary.ts";

describe("compile-binary includes", () => {
  function getIncludeFlags(): string[] {
    const args = createCompileArgs({
      entrypoint: "cli/main.ts",
      extraIncludes: [],
      output: "/tmp/test-veryfront",
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
