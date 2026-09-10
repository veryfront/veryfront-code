import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { copyPrivateSet } from "./private-set.ts";
import { copyPrivateMap } from "./private-map.ts";

Deno.test("private collection copy baseline ignores instance traversal hooks", () => {
  const members = new Set(["granted"]);
  const entries = new Map([["granted", 1]]);
  const unexpected = () => {
    throw new Error("Caller traversal was used");
  };
  Object.defineProperties(members, {
    [Symbol.iterator]: { value: unexpected },
    forEach: { value: unexpected },
    has: { value: unexpected },
    size: { get: unexpected },
  });
  Object.defineProperties(entries, {
    [Symbol.iterator]: { value: unexpected },
    forEach: { value: unexpected },
    get: { value: unexpected },
    size: { get: unexpected },
  });
  const memberCopy = copyPrivateSet(members);
  const entryCopy = copyPrivateMap(entries);
  members.add("later");
  entries.set("later", 2);
  assertEquals([...memberCopy], ["granted"]);
  assertEquals(memberCopy.has("denied"), false);
  assertEquals([...entryCopy], [["granted", 1]]);
  assertEquals(entryCopy.get("denied"), undefined);
  assertThrows(() => copyPrivateSet(members, 1), TypeError, "limit");
  assertThrows(() => copyPrivateMap(entries, 1), TypeError, "limit");
});
