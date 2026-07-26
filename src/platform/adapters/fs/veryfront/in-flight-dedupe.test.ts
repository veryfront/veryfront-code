import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
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
    assertEquals(result, undefined);
    assertEquals(!!deduper.get("a"), false);
    assertEquals(!!deduper.get("b"), true);
    assertEquals(!!deduper.get("c"), true);
  });

  it("does not let an older completion delete its replacement", () => {
    const deduper = new InFlightRequestDeduper<string>({
      timeoutMs: 100,
      maxEntries: 10,
      cleanupIntervalMs: 0,
    });
    const first = resolved();
    const replacement = Promise.resolve("replacement");
    const firstIdentity = Symbol("first");
    const replacementIdentity = Symbol("replacement");

    deduper.set("key", first, 0, firstIdentity);
    deduper.set("key", replacement, 200, replacementIdentity);
    deduper.delete("key", firstIdentity);
    assertEquals(deduper.get("key")?.promise, replacement);

    deduper.delete("key", replacementIdentity);
    assertEquals(deduper.get("key"), undefined);
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

  it("runs cleanup after the clock moves backwards", () => {
    const deduper = new InFlightRequestDeduper<string>({
      timeoutMs: 100,
      maxEntries: 10,
      cleanupIntervalMs: 1000,
    });

    deduper.cleanup(5000);
    deduper.set("stale", resolved(), 0);
    assertEquals(deduper.cleanup(101)?.cleanedCount, 1);
  });

  it("rejects invalid limits and timestamps", () => {
    for (
      const options of [
        { timeoutMs: -1, maxEntries: 1, cleanupIntervalMs: 0 },
        { timeoutMs: 1, maxEntries: 0, cleanupIntervalMs: 0 },
        { timeoutMs: 1, maxEntries: 1, cleanupIntervalMs: Number.NaN },
      ]
    ) {
      assertThrows(
        () => new InFlightRequestDeduper<string>(options),
        RangeError,
      );
    }

    const deduper = new InFlightRequestDeduper<string>({
      timeoutMs: 1,
      maxEntries: 1,
      cleanupIntervalMs: 0,
    });
    assertThrows(
      () => deduper.set("key", resolved(), Number.NaN),
      RangeError,
    );
    assertThrows(() => deduper.cleanup(Number.NaN), RangeError);
  });
});
