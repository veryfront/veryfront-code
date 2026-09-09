import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createPrivateMap } from "./private-map.ts";

describe("private maps", () => {
  it("destructures entry tuples without consulting an inherited array iterator", () => {
    const map = createPrivateMap<string, { text: string }>();
    const value = { text: "Synthetic private map value" };
    map.set("key", value);
    let observations = 0;
    for (const entries of [map.entries(), map[Symbol.iterator]()]) {
      const entry = entries.next().value!;
      Object.setPrototypeOf(
        entry,
        Object.create(Array.prototype, {
          [Symbol.iterator]: {
            get() {
              observations++;
              return Array.prototype[Symbol.iterator];
            },
          },
        }),
      );
      const [key, selected] = entry;
      assertEquals(key, "key");
      assertStrictEquals(selected, value);
    }
    assertEquals(observations, 0);
  });

  it("keeps entry values mutable and entry iterators exhausted after completion", () => {
    const map = createPrivateMap<string, number>();
    map.set("key", 1);
    const entry = map.entries().next().value!;
    const iterator = entry[Symbol.iterator]();
    assertEquals(iterator.next(), { done: false, value: "key" });
    entry[1] = 2;
    assertEquals(iterator.next(), { done: false, value: 2 });
    assertEquals(iterator.next(), { done: true, value: undefined });
    entry.push(3);
    assertEquals(iterator.next(), { done: true, value: undefined });
    assertEquals(map.get("key"), 1);
    assertEquals(Object.getPrototypeOf(iterator), null);
    assertEquals(Object.isFrozen(iterator), true);
  });

  it("preserves identity, insertion order, updates, and deletion through bound operations", () => {
    const map = createPrivateMap<string, { text: string }>();
    const first = { text: "first" };
    const second = { text: "second" };
    const { set, get, has, delete: remove, clear, values, keys, entries } = map;
    assertStrictEquals(set("first", first), map);
    set("second", second);
    set("first", second);
    assertStrictEquals(get("first"), second);
    assertEquals(has("second"), true);
    assertEquals(map.size, 2);
    assertEquals([...keys()], ["first", "second"]);
    assertEquals([...values()], [second, second]);
    assertEquals([...entries()], [["first", second], ["second", second]]);
    assertEquals([...map], [...entries()]);
    const context = {};
    const visited: string[] = [];
    map.forEach(function (this: unknown, value, key, owner) {
      assertStrictEquals(this, context);
      assertStrictEquals(owner, map);
      assertStrictEquals(value, second);
      visited.push(key);
    }, context);
    assertEquals(visited, ["first", "second"]);
    assertEquals(remove("first"), true);
    assertEquals(remove("missing"), false);
    assertEquals(get("first"), undefined);
    clear();
    assertEquals(map.size, 0);
    assertEquals([...values()], []);
  });

  it("retains native live iteration without writable operation or iterator lookups", () => {
    const map = createPrivateMap<string, number>();
    map.set("first", 1);
    const iterator = map.values();
    assertEquals(iterator.next(), { done: false, value: 1 });
    map.set("second", 2);
    assertEquals(iterator.next(), { done: false, value: 2 });
    assertEquals(iterator.next(), { done: true, value: undefined });
    assertEquals(Object.getPrototypeOf(iterator), null);
    assertEquals(Object.isFrozen(iterator), true);
    assertEquals(Object.isFrozen(map), true);
    assertEquals(Object.hasOwn(map, "get"), true);
    assertEquals(Object.hasOwn(map, "set"), true);
    assertEquals(Object.hasOwn(map, "values"), true);
  });
});
