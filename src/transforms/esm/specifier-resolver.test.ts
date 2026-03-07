import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { buildReplacements, rewriteModuleImports } from "./specifier-resolver.ts";

const cacheOptions = {
  cacheDir: "/tmp",
  importMap: {},
};

async function raceWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | { status: "timeout" }> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<{ status: "timeout" }>((resolve) => {
    timeoutId = setTimeout(() => resolve({ status: "timeout" }), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

describe("specifier-resolver", () => {
  it("propagates cache errors from buildReplacements", async () => {
    const result = await raceWithTimeout(
      buildReplacements(
        `import foo from "https://esm.sh/foo";`,
        "https://esm.sh/parent",
        cacheOptions,
        async () => {
          throw new Error("cache failed");
        },
      ).then(
        () => ({ status: "resolved" as const }),
        (error) => ({
          status: "rejected" as const,
          message: error instanceof Error ? error.message : String(error),
        }),
      ),
      100,
    );

    assertEquals(result, { status: "rejected", message: "cache failed" });
  });

  it("propagates cache errors from rewriteModuleImports", async () => {
    const result = await raceWithTimeout(
      rewriteModuleImports(
        `import foo from "https://esm.sh/foo";`,
        "https://esm.sh/parent",
        cacheOptions,
        async () => {
          throw new Error("cache failed");
        },
      ).then(
        () => ({ status: "resolved" as const }),
        (error) => ({
          status: "rejected" as const,
          message: error instanceof Error ? error.message : String(error),
        }),
      ),
      100,
    );

    assertEquals(result, { status: "rejected", message: "cache failed" });
  });
});
