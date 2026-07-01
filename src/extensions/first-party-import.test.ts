import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { firstPartyExtensionSourceSpecifiers } from "./first-party-import.ts";

describe("first-party extension imports", () => {
  it("tries Deno source before generated npm source", () => {
    assertEquals(firstPartyExtensionSourceSpecifiers("ext-schema-zod"), [
      "../../extensions/ext-schema-zod/src/index.ts",
      "../../extensions/ext-schema-zod/src/index.js",
    ]);
  });
});
