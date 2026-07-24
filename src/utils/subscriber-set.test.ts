import { describe, it } from "#veryfront/testing/bdd";
import { assertEquals } from "#veryfront/testing/assert";
import { createSubscriberSet } from "./subscriber-set.ts";

describe("utils/subscriber-set", () => {
  it("notifies all listeners with the given arguments", () => {
    const set = createSubscriberSet<[string]>();
    const seen: string[] = [];
    set.subscribe((value) => seen.push(`a:${value}`));
    set.subscribe((value) => seen.push(`b:${value}`));

    set.notify("x");
    assertEquals(seen, ["a:x", "b:x"]);
  });

  it("still notifies a listener that was unsubscribed earlier in the same notify (snapshot)", () => {
    const set = createSubscriberSet();
    const calls: string[] = [];
    // Register the remover FIRST so it removes a listener that has not run
    // yet. Live Set iteration would skip b; the snapshot must still call it.
    let unsubscribeB = () => {};
    set.subscribe(() => {
      calls.push("a");
      unsubscribeB();
    });
    unsubscribeB = set.subscribe(() => calls.push("b"));

    set.notify();
    assertEquals(calls, ["a", "b"]);

    // The removal still takes effect for subsequent notifies.
    set.notify();
    assertEquals(calls, ["a", "b", "a"]);
  });

  it("isolates a throwing listener so the rest still run", () => {
    const set = createSubscriberSet();
    const calls: string[] = [];
    set.subscribe(() => {
      throw new Error("bad listener");
    });
    set.subscribe(() => calls.push("survivor"));

    set.notify();
    assertEquals(calls, ["survivor"]);
  });

  it("routes listener errors to onListenerError", () => {
    const errors: unknown[] = [];
    const set = createSubscriberSet((error) => errors.push(error));
    set.subscribe(() => {
      throw new Error("routed");
    });

    set.notify();
    assertEquals((errors[0] as Error).message, "routed");
  });

  it("survives a throwing onListenerError and keeps notifying", () => {
    const calls: string[] = [];
    const set = createSubscriberSet(() => {
      throw new Error("bad error handler");
    });
    set.subscribe(() => {
      throw new Error("boom");
    });
    set.subscribe(() => calls.push("survivor"));

    set.notify();
    assertEquals(calls, ["survivor"]);
  });

  it("tracks size, ignores double-unsubscribe, and clears", () => {
    const set = createSubscriberSet();
    const unsubscribe = set.subscribe(() => {});
    set.subscribe(() => {});
    assertEquals(set.size, 2);

    unsubscribe();
    unsubscribe();
    assertEquals(set.size, 1);

    set.clear();
    assertEquals(set.size, 0);
  });
});
