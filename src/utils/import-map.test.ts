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
    assertEquals(importMapOwnsSpecifier("@/components/Button", { "@/": "/src" }), false);
  });

  it("merges default browser imports with project imports", () => {
    const merged = mergeBrowserImportMapImports({ "@/": "/src/" });
    assertEquals(merged.react, DEFAULT_BROWSER_IMPORT_MAP_IMPORTS.react);
    assertEquals(merged["@/"], "/src/");
  });

  it("does not let malformed runtime values replace default imports", () => {
    const merged = mergeBrowserImportMapImports({ react: 42 } as unknown as Record<string, string>);
    assertEquals(merged.react, "");
    assertEquals(
      importMapOwnsSpecifier("react", { react: 42 } as unknown as Record<string, string>),
      false,
    );
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

  it("rejects invalid import dictionaries instead of returning a mistyped value", () => {
    assertEquals(parseImportMapImports('{"imports":["react"]}'), {});
    assertEquals(parseImportMapImports('{"imports":{"react":42}}'), {});
    assertEquals(parseImportMapImports('{"imports":{"react":"/react.js","bad":null}}'), {});
  });

  it("rejects import-map JSON above the parser resource limit", () => {
    const warnings: unknown[][] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args);
    try {
      assertEquals(parseImportMapImports(" ".repeat(1_048_577)), {});
    } finally {
      console.warn = originalWarn;
    }
    assertEquals(warnings, [[
      "Import map JSON is invalid or too large; treating as empty",
      { inputLength: 1_048_577 },
    ]]);
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
