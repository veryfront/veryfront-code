import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  DEFAULT_BROWSER_IMPORT_MAP_IMPORTS,
  getDocumentImportMapImports,
  importMapOwnsSpecifier,
  MAX_IMPORT_MAP_ENTRIES,
  MAX_IMPORT_MAP_JSON_CHARACTERS,
  MAX_IMPORT_MAP_SPECIFIER_CHARACTERS,
  MAX_IMPORT_MAP_TARGET_CHARACTERS,
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

  it("parses import maps and rejects invalid JSON without exposing its contents", () => {
    assertEquals(
      parseImportMapImports('{"imports":{"react":"https://cdn.test/react.js"}}').react,
      "https://cdn.test/react.js",
    );

    const invalidImportMap = '{"imports":{"private":"private-import-target",}}';
    const error = assertThrows(
      () => parseImportMapImports(invalidImportMap),
      SyntaxError,
      "invalid JSON",
    );
    assertEquals(error.message.includes("private-import-target"), false);
  });

  it("rejects malformed import-map shapes", () => {
    const malformedImportMaps = [
      "null",
      '["private-array-target"]',
      '{"imports":"private-string-target"}',
      '{"imports":{"react":42,"safe":"private-record-target"}}',
    ];
    for (const importMap of malformedImportMaps) {
      const error = assertThrows(
        () => parseImportMapImports(importMap),
        TypeError,
      );
      assertEquals(error.message.includes("private-"), false);
    }
  });

  it("rejects prefix mappings whose targets are not prefixes", () => {
    assertThrows(
      () =>
        parseImportMapImports(
          '{"imports":{"pkg/":"https://cdn.test/pkg","safe":"https://cdn.test/safe.js"}}',
        ),
      TypeError,
      "prefix targets",
    );
  });

  it("rejects import maps outside fixed parsing and entry bounds", () => {
    assertThrows(
      () => parseImportMapImports(" ".repeat(MAX_IMPORT_MAP_JSON_CHARACTERS + 1)),
      RangeError,
    );
    assertThrows(
      () =>
        parseImportMapImports(JSON.stringify({
          imports: Object.fromEntries(
            Array.from(
              { length: MAX_IMPORT_MAP_ENTRIES + 1 },
              (_, index) => [`pkg-${index}`, `/pkg-${index}.js`],
            ),
          ),
        })),
      RangeError,
    );
    assertThrows(
      () =>
        parseImportMapImports(JSON.stringify({
          imports: {
            ["s".repeat(MAX_IMPORT_MAP_SPECIFIER_CHARACTERS + 1)]: "/safe.js",
          },
        })),
      RangeError,
    );
    assertThrows(
      () =>
        parseImportMapImports(JSON.stringify({
          imports: {
            safe: `/${"t".repeat(MAX_IMPORT_MAP_TARGET_CHARACTERS)}`,
          },
        })),
      RangeError,
    );
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

  it("fails before document import-map consumers can choose a fallback strategy", () => {
    for (const textContent of ["", '{"imports":{"react":}}']) {
      const doc = {
        querySelector: () => ({ textContent }),
      } as unknown as Document;

      assertThrows(
        () => getDocumentImportMapImports(doc),
        SyntaxError,
        "invalid JSON",
      );
    }
  });
});
