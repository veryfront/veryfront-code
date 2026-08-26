import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";

it("keeps Sentry lifecycle outside public package subpaths", async () => {
  const config = JSON.parse(
    await Deno.readTextFile(new URL("../../../../../deno.json", import.meta.url)),
  ) as { exports?: Record<string, string> };

  assertEquals(config.exports?.["./observability/sentry"], undefined);
});
