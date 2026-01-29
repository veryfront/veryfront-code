import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { CONTENT_TYPES } from "./content-types.ts";

describe("CONTENT_TYPES", () => {
  it("should be a non-empty record", () => {
    assert(Object.keys(CONTENT_TYPES).length > 0);
  });

  it("should map common file extensions to content types", () => {
    assertEquals(CONTENT_TYPES[".html"], "text/html; charset=utf-8");
    assertEquals(CONTENT_TYPES[".css"], "text/css; charset=utf-8");
    assertEquals(CONTENT_TYPES[".js"], "application/javascript; charset=utf-8");
    assertEquals(CONTENT_TYPES[".json"], "application/json; charset=utf-8");
    assertEquals(CONTENT_TYPES[".txt"], "text/plain; charset=utf-8");
  });

  it("should map .mjs to javascript content type", () => {
    assertEquals(CONTENT_TYPES[".mjs"], "application/javascript; charset=utf-8");
  });

  it("should map image extensions", () => {
    assert(CONTENT_TYPES[".png"] !== undefined);
    assert(CONTENT_TYPES[".jpg"] !== undefined);
    assert(CONTENT_TYPES[".jpeg"] !== undefined);
    assert(CONTENT_TYPES[".gif"] !== undefined);
    assert(CONTENT_TYPES[".svg"] !== undefined);
    assert(CONTENT_TYPES[".ico"] !== undefined);
    assert(CONTENT_TYPES[".webp"] !== undefined);
  });

  it("should have same content type for .jpg and .jpeg", () => {
    assertEquals(CONTENT_TYPES[".jpg"], CONTENT_TYPES[".jpeg"]);
  });

  it("should map font extensions", () => {
    assertEquals(CONTENT_TYPES[".woff"], "font/woff");
    assertEquals(CONTENT_TYPES[".woff2"], "font/woff2");
    assertEquals(CONTENT_TYPES[".ttf"], "font/ttf");
    assertEquals(CONTENT_TYPES[".otf"], "font/otf");
  });

  it("should have all keys starting with a dot", () => {
    for (const key of Object.keys(CONTENT_TYPES)) {
      assert(key.startsWith("."), `Key "${key}" should start with a dot`);
    }
  });
});
