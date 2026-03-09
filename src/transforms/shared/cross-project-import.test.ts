import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isCrossProjectImport, parseCrossProjectImport } from "./cross-project-import.ts";

describe("transforms/shared/cross-project-import", () => {
  describe("isCrossProjectImport", () => {
    const positiveTable: [string, string][] = [
      ["versioned import", "my-project@1.0.0/@/components/Button"],
      ["versioned with caret", "my-project@^1.0.0/@/components/Button"],
      ["versioned with tilde", "my-project@~2.3.4/@/lib/utils"],
      ["versioned with x range", "my-project@1.x/@/foo"],
      ["latest (no version)", "my-project/@/components/Button"],
      ["slug with digits", "app123/@/index"],
    ];

    for (const [label, specifier] of positiveTable) {
      it(`returns true for ${label}: ${specifier}`, () => {
        assertEquals(isCrossProjectImport(specifier), true);
      });
    }

    const negativeTable: [string, string][] = [
      ["plain bare import", "react"],
      ["scoped package", "@tanstack/react-query"],
      ["relative import", "./foo"],
      ["http URL", "https://esm.sh/react"],
      ["veryfront internal", "#veryfront/utils"],
      ["alias import", "@/components/Button"],
      ["empty string", ""],
      ["uppercase slug", "MyProject/@/foo"],
      ["no path after /@/", "my-project@1.0.0/@/"],
    ];

    for (const [label, specifier] of negativeTable) {
      it(`returns false for ${label}: ${specifier}`, () => {
        assertEquals(isCrossProjectImport(specifier), false);
      });
    }
  });

  describe("parseCrossProjectImport", () => {
    it("parses versioned import", () => {
      const result = parseCrossProjectImport("my-project@1.0.0/@/components/Button");
      assertEquals(result, {
        projectSlug: "my-project",
        version: "1.0.0",
        path: "components/Button",
      });
    });

    it("parses versioned import with caret", () => {
      const result = parseCrossProjectImport("my-project@^2.0.0/@/lib/utils");
      assertEquals(result, {
        projectSlug: "my-project",
        version: "^2.0.0",
        path: "lib/utils",
      });
    });

    it("parses latest (unversioned) import", () => {
      const result = parseCrossProjectImport("my-project/@/components/Button");
      assertEquals(result, {
        projectSlug: "my-project",
        version: "latest",
        path: "components/Button",
      });
    });

    it("parses slug with numbers", () => {
      const result = parseCrossProjectImport("app123/@/index");
      assertEquals(result, {
        projectSlug: "app123",
        version: "latest",
        path: "index",
      });
    });

    it("returns null for plain bare import", () => {
      assertEquals(parseCrossProjectImport("react"), null);
    });

    it("returns null for empty string", () => {
      assertEquals(parseCrossProjectImport(""), null);
    });

    it("returns null for scoped package", () => {
      assertEquals(parseCrossProjectImport("@tanstack/react-query"), null);
    });

    it("returns null for relative path", () => {
      assertEquals(parseCrossProjectImport("./foo"), null);
    });

    it("handles deep nested path", () => {
      const result = parseCrossProjectImport("proj@1.2.3/@/a/b/c/d.ts");
      assertEquals(result, {
        projectSlug: "proj",
        version: "1.2.3",
        path: "a/b/c/d.ts",
      });
    });
  });
});
