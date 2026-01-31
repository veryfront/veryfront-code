import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isCrossProjectImport, parseCrossProjectImport } from "./path-resolver.ts";

describe("transforms/esm/path-resolver", () => {
  describe("isCrossProjectImport", () => {
    it("should detect versioned cross-project imports", () => {
      assertEquals(isCrossProjectImport("demo@1.0/@/components/Button"), true);
    });

    it("should detect latest cross-project imports", () => {
      assertEquals(isCrossProjectImport("demo/@/components/Button"), true);
    });

    it("should reject regular imports", () => {
      for (const specifier of ["react", "./local", "@/alias"]) {
        assertEquals(isCrossProjectImport(specifier), false);
      }
    });

    it("should detect semver-range cross-project imports", () => {
      assertEquals(isCrossProjectImport("my-lib@^2.0.0/@/utils"), true);
    });

    it("should detect x-range versions", () => {
      assertEquals(isCrossProjectImport("pkg@1.x/@/mod"), true);
    });
  });

  describe("parseCrossProjectImport", () => {
    it("should parse versioned import", () => {
      const result = parseCrossProjectImport("demo@1.0/@/components/Button");
      assertEquals(result?.projectSlug, "demo");
      assertEquals(result?.version, "1.0");
      assertEquals(result?.path, "components/Button");
    });

    it("should parse latest import", () => {
      const result = parseCrossProjectImport("demo/@/components/Button");
      assertEquals(result?.projectSlug, "demo");
      assertEquals(result?.version, "latest");
      assertEquals(result?.path, "components/Button");
    });

    it("should return null for non-cross-project specifiers", () => {
      for (const specifier of ["react", "./local", "@/alias"]) {
        assertEquals(parseCrossProjectImport(specifier), null);
      }
    });

    it("should handle nested paths", () => {
      const result = parseCrossProjectImport("my-lib@2.0.0/@/deep/nested/path");
      assertEquals(result?.projectSlug, "my-lib");
      assertEquals(result?.version, "2.0.0");
      assertEquals(result?.path, "deep/nested/path");
    });

    it("should handle caret version ranges", () => {
      const result = parseCrossProjectImport("pkg@^1.0.0/@/utils");
      assertEquals(result?.projectSlug, "pkg");
      assertEquals(result?.version, "^1.0.0");
      assertEquals(result?.path, "utils");
    });
  });
});
