import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import * as publicMetrics from "veryfront/metrics";
import { ANSI, LEVEL_COLORS, LEVEL_GLYPHS } from "veryfront/utils/logger";

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

it("keeps public logger formatting registries immutable", () => {
  assertEquals(Object.isFrozen(ANSI), true);
  assertEquals(Object.isFrozen(LEVEL_COLORS), true);
  assertEquals(Object.isFrozen(LEVEL_GLYPHS), true);
});
