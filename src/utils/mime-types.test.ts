import { describe, it } from "jsr:@std/testing/bdd";
import { assertEquals } from "jsr:@std/assert";
import { charset, extension, lookup } from "./mime-types.ts";

describe("mime-types.lookup", () => {
  it("returns mime for known extensions", () => {
    assertEquals(lookup("index.html"), "text/html");
    assertEquals(lookup("app.js"), "application/javascript");
    assertEquals(lookup("data.json"), "application/json");
    assertEquals(lookup("logo.svg"), "image/svg+xml");
    assertEquals(lookup("font.woff2"), "font/woff2");
  });
  it("returns false for unknown extensions", () => {
    assertEquals(lookup("foo.xyz"), false);
  });
  it("accepts bare extensions", () => {
    assertEquals(lookup("css"), "text/css");
    assertEquals(lookup(".css"), "text/css");
  });
});

describe("mime-types.charset", () => {
  it("returns UTF-8 for text/* types", () => {
    assertEquals(charset("text/html"), "UTF-8");
    assertEquals(charset("text/plain"), "UTF-8");
  });
  it("returns UTF-8 for application/javascript and application/json", () => {
    assertEquals(charset("application/javascript"), "UTF-8");
    assertEquals(charset("application/json"), "UTF-8");
  });
  it("returns false for non-text types", () => {
    assertEquals(charset("image/png"), false);
  });
});

describe("mime-types.extension", () => {
  it("returns extension for known mime types", () => {
    assertEquals(extension("text/html"), "html");
    assertEquals(extension("application/json"), "json");
  });
  it("returns false for unknown mime types", () => {
    assertEquals(extension("application/x-unknown-custom"), false);
  });
});
