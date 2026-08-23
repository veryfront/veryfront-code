import "#veryfront/schemas/_test-setup.ts";
import { readTextFile } from "#veryfront/platform/compat/fs.ts";
import { fromFileUrl } from "#veryfront/platform/compat/path/index.ts";
import { assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("worker-script bootstrap source", () => {
  it("preloads host environment access before project modules", async () => {
    const source = await readTextFile(
      fromFileUrl(new URL("./worker-script.ts", import.meta.url)),
    );
    assertStringIncludes(
      source,
      'import "#veryfront/platform/compat/process/env.ts";',
    );
  });
});
