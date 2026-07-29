import { assertEquals } from "#veryfront/testing/assert.ts";
import { HTMLHeadLocatorName, MAX_HTML_HEAD_PARSE_BYTES } from "./html-head-locator.ts";

Deno.test("HTML head locator contract owns stable runtime identifiers", () => {
  assertEquals(HTMLHeadLocatorName, "HTMLHeadLocator");
  assertEquals(MAX_HTML_HEAD_PARSE_BYTES, 8_388_608);
});
