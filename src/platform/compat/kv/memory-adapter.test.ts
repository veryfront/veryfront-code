import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MemoryKv } from "./memory-adapter.ts";

async function collectEntries<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const entries: T[] = [];
  for await (const entry of iterable) {
    entries.push(entry);
  }
  return entries;
}

describe("MemoryKv", () => {
  describe("class", () => {
    it("should export MemoryKv class", () => {
      assertExists(MemoryKv);
      assertEquals(typeof MemoryKv, "function");
    });

    it("should be instantiable", () => {
      assertExists(new MemoryKv());
    });

    it("should have all required methods", () => {
      const kv = new MemoryKv();
      assertExists(kv.get);
      assertExists(kv.set);
      assertExists(kv.delete);
      assertExists(kv.list);
      assertExists(kv.close);
    });
  });

  describe("get/set", () => {
    it("should store and retrieve values", async () => {
      const kv = new MemoryKv();
      await kv.set(["test", "key"], "value");

      const result = await kv.get(["test", "key"]);
      assertEquals(result.value, "value");
      assertExists(result.versionstamp);
    });

    it("should return undefined for non-existent keys", async () => {
      const kv = new MemoryKv();
      const result = await kv.get(["non", "existent"]);
      assertEquals(result.value, undefined);
    });
  });

  describe("delete", () => {
    it("should delete values", async () => {
      const kv = new MemoryKv();
      await kv.set(["test", "key"], "value");
      await kv.delete(["test", "key"]);

      const result = await kv.get(["test", "key"]);
      assertEquals(result.value, undefined);
    });
  });

  describe("list", () => {
    it("should list all entries", async () => {
      const kv = new MemoryKv();
      await kv.set(["a"], 1);
      await kv.set(["b"], 2);
      await kv.set(["c"], 3);

      const entries = await collectEntries(kv.list());
      assertEquals(entries.length, 3);
    });

    it("should support limit option", async () => {
      const kv = new MemoryKv();
      await kv.set(["a"], 1);
      await kv.set(["b"], 2);
      await kv.set(["c"], 3);

      const entries = await collectEntries(kv.list({ limit: 2 }));
      assertEquals(entries.length, 2);
    });

    it("yields entries in ascending serialized-key order regardless of insert order", async () => {
      const kv = new MemoryKv();
      await kv.set(["c"], 3);
      await kv.set(["a"], 1);
      await kv.set(["b"], 2);

      assertEquals(
        (await collectEntries(kv.list())).map((entry) => entry.key.join("/")),
        ["a", "b", "c"],
        "list yields ascending serialized-key order regardless of insert order",
      );
    });

    it("yields entries in descending order with reverse", async () => {
      const kv = new MemoryKv();
      await kv.set(["c"], 3);
      await kv.set(["a"], 1);
      await kv.set(["b"], 2);

      assertEquals(
        (await collectEntries(kv.list({ reverse: true }))).map((entry) => entry.key.join("/")),
        ["c", "b", "a"],
        "reverse yields descending serialized-key order",
      );
    });

    it("applies an inclusive start and an exclusive end bound", async () => {
      const kv = new MemoryKv();
      await kv.set(["c"], 3);
      await kv.set(["a"], 1);
      await kv.set(["b"], 2);

      assertEquals(
        (await collectEntries(kv.list({ start: ["b"] }))).map((entry) => entry.key.join("/")),
        ["b", "c"],
        "start is an inclusive lower bound",
      );
      assertEquals(
        (await collectEntries(kv.list({ end: ["c"] }))).map((entry) => entry.key.join("/")),
        ["a", "b"],
        "end is an exclusive upper bound",
      );
    });

    it("orders mixed-case keys by code unit like SqliteKv's ORDER BY key", async () => {
      const kv = new MemoryKv();
      await kv.set(["a"], 1);
      await kv.set(["B"], 2);
      await kv.set(["b"], 3);

      assertEquals(
        (await collectEntries(kv.list())).map((entry) => entry.key.join("/")),
        ["B", "a", "b"],
        "list must sort on code units so MemoryKv matches SQLite's binary ORDER BY key",
      );
    });

    it("matches prefixes by complete key parts", async () => {
      const kv = new MemoryKv();
      await kv.set(["a"], "exact");
      await kv.set(["a", "child"], "child");
      await kv.set(["ab"], "collision");

      const entries = await collectEntries(kv.list({ prefix: ["a"] }));
      assertEquals(entries.map((entry) => entry.key.join("/")).sort(), ["a", "a/child"]);
    });

    it("treats a zero limit as an empty result", async () => {
      const kv = new MemoryKv();
      await kv.set(["a"], 1);

      assertEquals(await collectEntries(kv.list({ limit: 0 })), []);
    });

    it("rejects invalid limits", async () => {
      const kv = new MemoryKv();

      for (const limit of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        await assertRejects(
          () => collectEntries(kv.list({ limit })),
          RangeError,
          "non-negative safe integer",
        );
      }
    });
  });

  describe("value isolation", () => {
    it("snapshots values on write and read", async () => {
      const kv = new MemoryKv();
      const input = { nested: { count: 1 } };
      await kv.set(["object"], input);
      input.nested.count = 2;

      const first = await kv.get<typeof input>(["object"]);
      assertEquals(first.value, { nested: { count: 1 } });
      first.value!.nested.count = 3;

      assertEquals((await kv.get<typeof input>(["object"])).value, {
        nested: { count: 1 },
      });
    });

    it("generates a distinct versionstamp for every write", async () => {
      const kv = new MemoryKv();
      const originalNow = Date.now;
      Date.now = () => 123;
      try {
        await kv.set(["key"], "first");
        const first = (await kv.get(["key"])).versionstamp;
        await kv.set(["key"], "second");
        const second = (await kv.get(["key"])).versionstamp;

        assertExists(first);
        assertExists(second);
        assertEquals(first === second, false);
      } finally {
        Date.now = originalNow;
      }
    });

    it("rejects values without a JSON representation", async () => {
      const kv = new MemoryKv();
      await assertRejects(
        () => kv.set(["undefined"], undefined),
        TypeError,
        "JSON-serializable",
      );
    });
  });

  describe("key validation", () => {
    it("rejects sparse keys instead of storing unreadable entries", async () => {
      const kv = new MemoryKv();
      await assertRejects(
        () => kv.set(new Array<string>(1), "value"),
        TypeError,
        "arrays of strings",
      );
    });
  });

  describe("close", () => {
    it("should clear the store on close", async () => {
      const kv = new MemoryKv();
      await kv.set(["test"], "value");
      kv.close();

      const result = await kv.get(["test"]);
      assertEquals(result.value, undefined);
    });
  });
});
