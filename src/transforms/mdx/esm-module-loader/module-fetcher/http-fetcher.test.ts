import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { Logger } from "#veryfront/utils/logger/logger.ts";
import { fetchModuleViaHTTP } from "./http-fetcher.ts";

describe("module-fetcher/http-fetcher", () => {
  it("rewrites the matched import instead of the same text in an earlier comment", async () => {
    const originalFetch = globalThis.fetch;
    const logger = { debug: () => {}, warn: () => {} } as unknown as Logger;
    const adapter = {
      env: {
        get(key: string) {
          if (key === "VERYFRONT_DEV_PORT") return "3001";
          return undefined;
        },
      },
    } as RuntimeAdapter;

    try {
      globalThis.fetch = async () =>
        new Response([
          `// Previous example: from "./local.js"`,
          `import local from "./local.js";`,
          `export { local };`,
        ].join("\n"));

      const result = await fetchModuleViaHTTP(
        "_vf_modules/pages/index.js",
        adapter,
        (path) => Promise.resolve(`/cache/${path.replaceAll("/", "__")}.mjs`),
        logger,
        "docs",
        true,
      );

      assertEquals(
        result,
        [
          `// Previous example: from "./local.js"`,
          `import local from "file:///cache/.__local.js.mjs";`,
          `export { local };`,
        ].join("\n"),
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
