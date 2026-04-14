/**
 * Extension init command tests.
 *
 * @module cli/commands/extension/init-command.test
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { generateExtensionFiles } from "./init-command.ts";

describe("extension init command", () => {
  describe("generateExtensionFiles()", () => {
    it("should generate index.ts with correct extension name", () => {
      const files = generateExtensionFiles("my-cache");
      const indexFile = files.find((f) => f.path.endsWith("index.ts") && !f.path.includes("test"));
      assertEquals(indexFile !== undefined, true);
      assertEquals(indexFile!.content.includes('"my-cache"'), true);
      assertEquals(indexFile!.content.includes("ExtensionFactory"), true);
    });

    it("should generate a test file", () => {
      const files = generateExtensionFiles("my-cache");
      const testFile = files.find((f) => f.path.endsWith("test.ts"));
      assertEquals(testFile !== undefined, true);
      assertEquals(testFile!.content.includes("describe"), true);
    });

    it("should generate deno.json with extension metadata", () => {
      const files = generateExtensionFiles("my-cache");
      const denoJson = files.find((f) => f.path.endsWith("deno.json"));
      assertEquals(denoJson !== undefined, true);
      const parsed = JSON.parse(denoJson!.content);
      assertEquals(parsed.veryfront.extension, true);
    });

    it("should place files under extensions/<name>/", () => {
      const files = generateExtensionFiles("my-cache");
      for (const f of files) {
        assertEquals(f.path.startsWith("extensions/my-cache/"), true);
      }
    });
  });
});
