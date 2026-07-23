import "#veryfront/schemas/_test-setup.ts";
import { assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { denoAdapter } from "#veryfront/platform/adapters/runtime/deno/index.ts";
import { loadComponentsUnified } from "./unified-loader.ts";

describe("modules/react-loader/unified-loader", () => {
  it("rejects duplicate component names before transforming", async () => {
    await assertRejects(
      () =>
        loadComponentsUnified(
          [
            { name: "Duplicate", source: "export default () => null", filePath: "a.tsx" },
            { name: "Duplicate", source: "export default () => null", filePath: "b.tsx" },
          ],
          "/project",
          denoAdapter,
        ),
      Error,
      "Component names must be unique",
    );
  });

  it("rejects control characters in component names", async () => {
    await assertRejects(
      () =>
        loadComponentsUnified(
          [{ name: "Bad\nName", source: "export default () => null", filePath: "a.tsx" }],
          "/project",
          denoAdapter,
        ),
      Error,
      "Component name is invalid",
    );
  });
});
