import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { InFlightRequestDeduper } from "./in-flight-dedupe.ts";

function resolved(): Promise<string> {
  return Promise.resolve("ok");
}

describe("veryfront/in-flight-dedupe", () => {
  it("removes stale entries older than timeout", () => {
    const deduper = new InFlightRequestDeduper<string>({
      timeoutMs: 100,
      maxEntries: 10,
      cleanupIntervalMs: 0,
    });

    deduper.set("fresh", resolved(), 950);
    deduper.set("stale", resolved(), 800);

    const result = deduper.cleanup(1001);
    assertEquals(result?.cleanedCount, 1);
    assertEquals(result?.remainingCount, 1);
    assertEquals(!!deduper.get("stale"), false);
    assertEquals(!!deduper.get("fresh"), true);
  });

  it("removes oldest entries when max size is exceeded", () => {
    const deduper = new InFlightRequestDeduper<string>({
      timeoutMs: 60_000,
      maxEntries: 2,
      cleanupIntervalMs: 0,
    });

    deduper.set("a", resolved(), 100);
    deduper.set("b", resolved(), 200);
    deduper.set("c", resolved(), 300);

    const result = deduper.cleanup(400);
    assertEquals(result?.cleanedCount, 1);
    assertEquals(result?.remainingCount, 2);
    assertEquals(!!deduper.get("a"), false);
    assertEquals(!!deduper.get("b"), true);
    assertEquals(!!deduper.get("c"), true);
  });

  it("respects cleanup interval and skips frequent cleanup calls", () => {
    const deduper = new InFlightRequestDeduper<string>({
      timeoutMs: 100,
      maxEntries: 10,
      cleanupIntervalMs: 1000,
    });

    deduper.set("stale", resolved(), 0);
    assertEquals(deduper.cleanup(1000)?.cleanedCount, 1);

    deduper.set("stale2", resolved(), 1000);
    assertEquals(deduper.cleanup(1500), undefined);
    assertEquals(!!deduper.get("stale2"), true);
  });
});
