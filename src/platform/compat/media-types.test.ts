import { assertEquals } from "std/assert/mod.ts";
import { charset, contentType, extension, lookup } from "./media-types.ts";

Deno.test("media types compat | basics", () => {
  assertEquals(contentType("test.html")?.startsWith("text/html"), true);
  assertEquals(extension("text/css"), "css");
  assertEquals(typeof lookup(".js"), "string");
  assertEquals(typeof charset("text/html"), "string");
});
