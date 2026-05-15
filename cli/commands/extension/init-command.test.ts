import "#veryfront/schemas/_test-setup.ts";
/**
 * Extension init command tests.
 *
 * @module cli/commands/extension/init-command.test
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { generateExtensionFiles, validateExtensionName } from "./init-command.ts";

describe("extension init command", () => {
  describe("validateExtensionName()", () => {
    it("should accept valid slug names", () => {
      assertEquals(validateExtensionName("my-cache"), undefined);
      assertEquals(validateExtensionName("ext123"), undefined);
    });

    it("should reject path traversal", () => {
      const err = validateExtensionName("../tmp");
      assertEquals(err !== undefined, true);
    });

    it("should reject names with slashes", () => {
      assertEquals(validateExtensionName("foo/bar") !== undefined, true);
    });

    it("should reject empty names", () => {
      assertEquals(validateExtensionName("") !== undefined, true);
    });

    it("should reject uppercase names", () => {
      assertEquals(validateExtensionName("MyCache") !== undefined, true);
    });

    it("should reject names starting with a hyphen", () => {
      assertEquals(validateExtensionName("-leading") !== undefined, true);
    });

    it("should reject names longer than 64 characters", () => {
      const longName = "a".repeat(65);
      assertEquals(validateExtensionName(longName) !== undefined, true);
    });

    it("should accept names exactly 64 characters long", () => {
      const name64 = "a".repeat(64);
      assertEquals(validateExtensionName(name64), undefined);
    });
  });

  describe("generateExtensionFiles()", () => {
    it("should generate index.ts with correct extension name", () => {
      const files = generateExtensionFiles("my-cache");
      const indexFile = files.find((f) => f.path.endsWith("index.ts") && !f.path.includes("test"));
      assertEquals(indexFile !== undefined, true);
      assertEquals(indexFile!.content.includes('"my-cache"'), true);
      assertEquals(indexFile!.content.includes("ExtensionFactory"), true);
      assertEquals(indexFile!.content.includes("contracts: {"), true);
      assertEquals(indexFile!.content.includes("provides: []"), true);
      assertEquals(indexFile!.content.includes("requires: []"), true);
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
      assertEquals(parsed.veryfront.contracts.provides, []);
      assertEquals(parsed.veryfront.contracts.requires, []);
    });

    it("should place files under extensions/<name>/", () => {
      const files = generateExtensionFiles("my-cache");
      for (const f of files) {
        assertEquals(f.path.startsWith("extensions/my-cache/"), true);
      }
    });

    it("should import ExtensionFactory from the public veryfront/extensions path", () => {
      const files = generateExtensionFiles("my-cache");
      const indexFile = files.find((f) => f.path.endsWith("src/index.ts"));
      const content = indexFile!.content;
      assertEquals(
        content.includes('from "veryfront/extensions"'),
        true,
        "scaffold must import from the public barrel, not a deep internal path",
      );
      assertEquals(
        content.includes("import type { ExtensionFactory }"),
        true,
      );
    });

    it("should not type-annotate unused parameters in the scaffold", () => {
      const files = generateExtensionFiles("my-cache");
      const indexFile = files.find((f) => f.path.endsWith("src/index.ts"));
      const content = indexFile!.content;
      // The factory takes no args in the scaffold. This avoids TS7006 in strict
      // user projects (implicit-any on an unused `config?` parameter).
      assertEquals(content.includes("(config?)"), false);
      assertEquals(content.includes(": ExtensionFactory = ()"), true);
    });
  });
});
