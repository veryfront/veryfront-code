import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { startExecutorRuntimeEntrypoint } from "./executor-runtime-entrypoint.ts";

it("executor profile rejects invalid JavaScript values before bootstrap access", async () => {
  for (const mode of ["project-tool", "", null, false, 1, {}]) {
    let accesses = 0;
    const input = {
      mode,
      environment: {
        get() {
          accesses++;
          return undefined;
        },
      },
      readArtifact() {
        accesses++;
        throw new Error("Unexpected artifact access");
      },
      readKey() {
        accesses++;
        throw new Error("Unexpected key access");
      },
    } as unknown as Parameters<typeof startExecutorRuntimeEntrypoint>[0];
    await assertRejects(
      () => startExecutorRuntimeEntrypoint(input),
      TypeError,
      "Invalid executor installation profile",
    );
    assertEquals(accesses, 0);
  }
});
