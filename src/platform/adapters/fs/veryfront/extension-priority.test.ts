import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  READ_OPERATION_EXTENSION_PRIORITY,
  STAT_OPERATION_EXTENSION_PRIORITY,
} from "./extension-priority.ts";

describe("platform/adapters/fs/veryfront/extension-priority", () => {
  describe("READ_OPERATION_EXTENSION_PRIORITY", () => {
    it("should have 6 extensions", () => {
      assertEquals(READ_OPERATION_EXTENSION_PRIORITY.length, 6);
    });

    it("should prioritize tsx first", () => {
      assertEquals(READ_OPERATION_EXTENSION_PRIORITY[0], ".tsx");
    });

    it("should contain all expected extensions", () => {
      const expected = [".tsx", ".ts", ".jsx", ".js", ".mdx", ".md"];
      assertEquals([...READ_OPERATION_EXTENSION_PRIORITY], expected);
    });

    it("should place TypeScript extensions before JavaScript", () => {
      const tsxIndex = READ_OPERATION_EXTENSION_PRIORITY.indexOf(".tsx");
      const jsxIndex = READ_OPERATION_EXTENSION_PRIORITY.indexOf(".jsx");
      assertEquals(tsxIndex < jsxIndex, true);
    });
  });

  describe("STAT_OPERATION_EXTENSION_PRIORITY", () => {
    it("should pin the exact stat resolution precedence", () => {
      const expected = [".mdx", ".md", ".tsx", ".jsx", ".ts", ".js"];
      assertEquals(
        [...STAT_OPERATION_EXTENSION_PRIORITY],
        expected,
        "stat resolution precedence is a contract",
      );
    });

    it("should contain the same extensions as READ_OPERATION_EXTENSION_PRIORITY", () => {
      const readSorted = [...READ_OPERATION_EXTENSION_PRIORITY].sort();
      const statSorted = [...STAT_OPERATION_EXTENSION_PRIORITY].sort();
      assertEquals(readSorted, statSorted);
    });
  });
});
