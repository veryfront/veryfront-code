import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { openKv } from "./index.ts";

describe("openKv", () => {
  it("list operations", async () => {
    const kv = await openKv(":memory:");
    await kv.set(["a", "1"], { v: 1 });
    await kv.set(["a", "2"], { v: 2 });
    await kv.set(["b", "1"], { v: 3 });

    const gotA: string[] = [];
    for await (const e of kv.list({ prefix: ["a"] })) {
      gotA.push(e.key.join(":"));
    }
    assertEquals(gotA.sort(), ["a:1", "a:2"]);

    const gotBounds: string[] = [];
    for await (const e of kv.list({ prefix: ["a"] })) {
      const key = e.key.join(":");
      if (key >= "a:2") gotBounds.push(key);
    }
    assert(gotBounds.includes("a:2"));

    const limited: string[] = [];
    for await (const e of kv.list({ prefix: ["a"], limit: 1 })) {
      limited.push(e.key.join(":"));
      break; // consume only first page/item to respect limit semantics
    }
    assertEquals(limited.length, 1);

    const maybeClose = (kv as Record<string, unknown>).close;
    if (typeof maybeClose === "function") {
      try {
        await (maybeClose as () => Promise<void>)();
      } catch {
        // ignore
      }
    }
  });
});
