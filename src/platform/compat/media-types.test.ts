import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { charset, contentType, extension, lookup } from "./media-types.ts";

describe("media types compat", () => {
  it("basics", () => {
    assertEquals(contentType("test.html")?.startsWith("text/html"), true);
    assertEquals(extension("text/css"), "css");
    assertEquals(typeof lookup(".js"), "string");
    assertEquals(typeof charset("text/html"), "string");
  });
});
