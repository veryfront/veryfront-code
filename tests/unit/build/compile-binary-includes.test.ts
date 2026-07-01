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
});
