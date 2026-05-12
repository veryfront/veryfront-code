import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getHydrateScript } from "./dev-loader.ts";

describe("server/handlers/dev/scripts/dev-loader", () => {
  it("keeps hydrate.js as a compatibility shim for the RSC client", () => {
    const script = getHydrateScript("my-slug");

    assertEquals(script.includes("import '/_veryfront/rsc/client.js';"), true);
    assertEquals(script.includes("import { hydrate }"), false);
    assertEquals(script.includes("my-slug"), false);
  });
});
