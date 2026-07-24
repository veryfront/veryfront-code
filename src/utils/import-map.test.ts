import "#veryfront/schemas/_test-setup.ts";
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

  it("parses import maps and tolerates invalid JSON without logging its contents", () => {
    assertEquals(
      parseImportMapImports('{"imports":{"react":"https://cdn.test/react.js"}}').react,
      "https://cdn.test/react.js",
    );

    const invalidImportMap = '{"imports":{"private":"private-import-target",}}';
    const warnings: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args);
    try {
      assertEquals(parseImportMapImports(invalidImportMap), {});
    } finally {
      console.warn = originalWarn;
    }

    assertEquals(warnings.length, 1);
    assertEquals(JSON.stringify(warnings).includes("private-import-target"), false);
    assertEquals(warnings[0]?.[1], {
      errorName: "SyntaxError",
      inputLength: invalidImportMap.length,
    });
  });

  it("rejects malformed import-map shapes without logging their contents", () => {
    const malformedImportMaps = [
      "null",
      '["private-array-target"]',
      '{"imports":"private-string-target"}',
      '{"imports":{"react":42,"safe":"private-record-target"}}',
    ];
    const warnings: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args);
    try {
      for (const importMap of malformedImportMaps) {
        assertEquals(parseImportMapImports(importMap), {});
      }
    } finally {
      console.warn = originalWarn;
    }

    assertEquals(warnings.length, malformedImportMaps.length);
    const serializedWarnings = JSON.stringify(warnings);
    assertEquals(serializedWarnings.includes("private-array-target"), false);
    assertEquals(serializedWarnings.includes("private-string-target"), false);
    assertEquals(serializedWarnings.includes("private-record-target"), false);
  });

  it("rejects prefix mappings whose targets are not prefixes", () => {
    const warnings: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args);
    try {
      assertEquals(
        parseImportMapImports(
          '{"imports":{"pkg/":"https://cdn.test/pkg","safe":"https://cdn.test/safe.js"}}',
        ),
        {},
      );
    } finally {
      console.warn = originalWarn;
    }

    assertEquals(warnings.length, 1);
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
