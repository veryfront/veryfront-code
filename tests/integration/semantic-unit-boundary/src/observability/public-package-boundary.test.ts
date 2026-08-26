import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import * as publicMetrics from "veryfront/metrics";

it("keeps Sentry lifecycle outside public package subpaths", async () => {
  const config = JSON.parse(
    await Deno.readTextFile(new URL("../../../../../deno.json", import.meta.url)),
  ) as { exports?: Record<string, string> };

  assertEquals(config.exports?.["./observability/sentry"], undefined);
});

it("keeps metrics reset hooks outside the public package", () => {
  assertEquals(Object.isFrozen(publicMetrics.metrics), true);
  assertEquals("__resetForTests" in publicMetrics.metrics, false);
  assertEquals("__flushForTests" in publicMetrics.metrics, false);
});
