import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { generateClientScripts, generateRedirectsFile } from "./output-generator.ts";

describe("build/production-build/build/output-generator", () => {
  describe("generateClientScripts", () => {
    it("should skip writing when dryRun is true", async () => {
      const writes: string[] = [];
      const adapter = {
        fs: {
          writeFile(path: string, _content: string) {
            writes.push(path);
            return Promise.resolve();
          },
        },
      };

      // deno-lint-ignore no-explicit-any
      await generateClientScripts(adapter as any, "/output", true);
      assertEquals(writes.length, 0);
    });
  });

  describe("generateRedirectsFile", () => {
    it("should skip writing when dryRun is true", async () => {
      const writes: string[] = [];
      const adapter = {
        fs: {
          writeFile(path: string, _content: string) {
            writes.push(path);
            return Promise.resolve();
          },
        },
      };

      // deno-lint-ignore no-explicit-any
      await generateRedirectsFile(adapter as any, "/output", true);
      assertEquals(writes.length, 0);
    });

    it("should write _redirects file when not dryRun", async () => {
      const writes: { path: string; content: string }[] = [];
      const adapter = {
        fs: {
          writeFile(path: string, content: string) {
            writes.push({ path, content });
            return Promise.resolve();
          },
        },
      };

      // deno-lint-ignore no-explicit-any
      await generateRedirectsFile(adapter as any, "/output", false);
      assertEquals(writes.length, 1);
      assertEquals(writes[0].path.includes("_redirects"), true);
      assertEquals(writes[0].content.includes("/*"), true);
    });
  });
});
