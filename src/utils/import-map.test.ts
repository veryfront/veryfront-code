import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  DEFAULT_BROWSER_IMPORT_MAP_IMPORTS,
  getDocumentImportMapImports,
  importMapOwnsSpecifier,
  mergeBrowserImportMapImports,
  parseImportMapImports,
} from "./import-map.ts";

describe("utils/import-map", () => {
  it("treats exact empty-string import-map entries as owned", () => {
    assertEquals(importMapOwnsSpecifier("react", { react: "" }), true);
  });

  it("treats prefix entries as owned", () => {
    assertEquals(importMapOwnsSpecifier("@/components/Button", { "@/": "/src/" }), true);
  });

  it("merges default browser imports with project imports", () => {
    const merged = mergeBrowserImportMapImports({ "@/": "/src/" });
    assertEquals(merged.react, DEFAULT_BROWSER_IMPORT_MAP_IMPORTS.react);
    assertEquals(merged["@/"], "/src/");
  });

  it("parses import maps and tolerates invalid JSON", () => {
    assertEquals(
      parseImportMapImports('{"imports":{"react":"https://cdn.test/react.js"}}').react,
      "https://cdn.test/react.js",
    );
    assertEquals(parseImportMapImports("{not json}"), {});
  });

  it("reads the page import map from the document", () => {
    const doc = {
      querySelector: (selector: string) =>
        selector === 'script[type="importmap"]'
          ? {
            textContent: '{"imports":{"react":"https://cdn.test/react.js"}}',
          }
          : null,
    } as unknown as Document;

    assertEquals(getDocumentImportMapImports(doc).react, "https://cdn.test/react.js");
  });
});
