import { assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform";
import { importDiscoveryModule } from "./module-import.ts";

const unusedAdapter = {
  fs: {},
} as RuntimeAdapter;

describe("discovery module import", () => {
  it("rejects relative entry paths outside the project root", async () => {
    await assertRejects(
      () =>
        importDiscoveryModule("../outside/task.ts", {
          adapter: unusedAdapter,
          projectDir: "/project",
        }),
      TypeError,
      "outside the project root",
    );
  });

  it("rejects absolute entry paths outside the project root", async () => {
    await assertRejects(
      () =>
        importDiscoveryModule("file:///outside/task.ts", {
          adapter: unusedAdapter,
          projectDir: "/project",
        }),
      TypeError,
      "outside the project root",
    );
  });
});
