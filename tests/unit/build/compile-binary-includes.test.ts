import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createCompileArgs } from "../../../scripts/build/compile-binary.ts";

describe("compile-binary includes", () => {
  it("should include src/rendering/rsc for client hydration scripts", () => {
    // Regression: client-boot.ts and client-dom.ts must be embedded in the
    // compiled binary, otherwise RSC hydration fails with
    // "path not found: readfile '.../src/rendering/rsc/client-boot.ts'"
    const args = createCompileArgs({
      entrypoint: "cli/main.ts",
      extraIncludes: [],
      output: "/tmp/test-veryfront",
    });

    const includeFlags: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--include" && args[i + 1]) {
        includeFlags.push(args[i + 1]);
      }
    }

    const hasRscRendering = includeFlags.some((p) => p.includes("rendering/rsc"));
    assertEquals(
      hasRscRendering,
      true,
      `Expected --include flag for src/rendering/rsc, got includes: ${
        JSON.stringify(includeFlags)
      }`,
    );
  });
});
