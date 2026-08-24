import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
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

    const bounded: string[] = [];
    for await (const e of kv.list({ prefix: ["a"], start: ["a", "2"] })) {
      bounded.push(e.key.join(":"));
    }
    assertEquals(bounded, ["a:2"], "a start bound must exclude earlier keys");

    const upper: string[] = [];
    for await (const e of kv.list({ prefix: ["a"], end: ["a", "2"] })) {
      upper.push(e.key.join(":"));
    }
    assertEquals(upper, ["a:1"], "an end bound must be exclusive");

    const limited: string[] = [];
    for await (const e of kv.list({ prefix: ["a"], limit: 1 })) {
      limited.push(e.key.join(":"));
    }
    assertEquals(limited, ["a:1"], "limit must be honoured by the adapter, not the consumer");

    try {
      kv.close();
    } catch {
      // ignore
    }
  });
});
