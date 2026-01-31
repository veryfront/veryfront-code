import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { CONTENT_TYPES } from "./content-types.ts";

describe("CONTENT_TYPES", () => {
  it("should be a non-empty record", () => {
    assert(Object.keys(CONTENT_TYPES).length > 0);
  });

  it("should map common file extensions to content types", () => {
    const cases: Array<[string, string]> = [
      [".html", "text/html; charset=utf-8"],
      [".css", "text/css; charset=utf-8"],
      [".js", "application/javascript; charset=utf-8"],
      [".mjs", "application/javascript; charset=utf-8"],
      [".json", "application/json; charset=utf-8"],
      [".txt", "text/plain; charset=utf-8"],
    ];

    for (const [ext, type] of cases) {
      assertEquals(CONTENT_TYPES[ext], type);
    }
  });

  it("should map image extensions", () => {
    const extensions = [".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp"];

    for (const ext of extensions) {
      assert(CONTENT_TYPES[ext] !== undefined);
    }
  });

  it("should have same content type for .jpg and .jpeg", () => {
    assertEquals(CONTENT_TYPES[".jpg"], CONTENT_TYPES[".jpeg"]);
  });

  it("should map font extensions", () => {
    const cases: Array<[string, string]> = [
      [".woff", "font/woff"],
      [".woff2", "font/woff2"],
      [".ttf", "font/ttf"],
      [".otf", "font/otf"],
    ];

    for (const [ext, type] of cases) {
      assertEquals(CONTENT_TYPES[ext], type);
    }
  });

  it("should have all keys starting with a dot", () => {
    for (const key of Object.keys(CONTENT_TYPES)) {
      assert(key.startsWith("."), `Key "${key}" should start with a dot`);
    }
  });
});
