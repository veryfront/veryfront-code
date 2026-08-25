import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { compareBy, compareStrings } from "./compare.ts";

describe("compareStrings", () => {
  it("orders identically to a bare sort()", () => {
    const samples = [
      ["b", "a", "c"],
      ["Zebra", "apple", "_private", "Apple", "10", "9", "2"],
      ["tool_search", "toolSearch", "tool-search", "Tool_Search"],
      ["ä", "a", "z", "Z", "é", "e"],
      ["", "a", " a", "a "],
    ];
    for (const sample of samples) {
      assertEquals([...sample].sort(compareStrings), [...sample].sort());
    }
  });

  it("does not reorder by locale the way localeCompare does", () => {
    // Guards the reason this helper exists: localeCompare collates by locale, so
    // swapping it in here would silently reorder cache keys and hashed manifests.
    // The contrast side pins "en-US" on purpose. Leaving the locale to the host
    // would make this test depend on the runner's default -- under sv-SE, "a"
    // sorts after "z" -- which is the very non-determinism being guarded against.
    const toolNames = ["Tool", "tool"];
    assertEquals(toolNames.toSorted(compareStrings), ["Tool", "tool"]);
    assertEquals(
      toolNames.toSorted((left, right) => left.localeCompare(right, "en-US")),
      ["tool", "Tool"],
    );

    const accented = ["a", "\u00e4", "z"];
    assertEquals(accented.toSorted(compareStrings), ["a", "z", "\u00e4"]);
    assertEquals(
      accented.toSorted((left, right) => left.localeCompare(right, "en-US")),
      ["a", "\u00e4", "z"],
    );
  });

  it("returns 0 for equal values", () => {
    assertEquals(compareStrings("same", "same"), 0);
  });

  it("is antisymmetric", () => {
    assertEquals(compareStrings("a", "b"), -1);
    assertEquals(compareStrings("b", "a"), 1);
  });

  it("is a stable sort key, so equal elements keep input order", () => {
    const input = [{ id: "b", n: 1 }, { id: "a", n: 2 }, { id: "a", n: 3 }];
    assertEquals(
      input.toSorted(compareBy((entry) => entry.id)).map((entry) => entry.n),
      [2, 3, 1],
    );
  });
});

describe("compareBy", () => {
  it("orders by the extracted key", () => {
    const input = [{ name: "gamma" }, { name: "alpha" }, { name: "beta" }];
    assertEquals(
      input.toSorted(compareBy((entry) => entry.name)).map((entry) => entry.name),
      ["alpha", "beta", "gamma"],
    );
  });
});
