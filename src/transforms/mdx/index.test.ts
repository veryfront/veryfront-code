import "#veryfront/schemas/_test-setup.ts";

import { assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { mdxRenderer } from "./index.ts";

describe("MDXRenderer.loadModuleESM", () => {
  it("treats an explicit undefined options argument as empty options", async () => {
    const compiled = `
      export const marker = "undefined-options";
      export default marker;
    `;

    await assertRejects(
      () => mdxRenderer.loadModuleESM(compiled, undefined),
      Error,
      "Missing projectId for MDX ESM cache directory",
    );
  });
});
