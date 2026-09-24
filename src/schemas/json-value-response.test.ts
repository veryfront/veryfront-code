import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { snapshotBoundedJsonValue, snapshotBoundedParsedJsonValue } from "./json-value.ts";

describe("byte-bounded parsed JSON snapshots", () => {
  it("keeps authored string and aggregate defaults unchanged", () => {
    const large = "a".repeat(1400000);
    assertEquals(snapshotBoundedJsonValue({ data: large }).success, false);
    assertEquals(snapshotBoundedParsedJsonValue({ data: large }, 4 * 1024 * 1024).success, true);
    const many = Array.from({ length: 6 }, () => "a".repeat(900000));
    assertEquals(snapshotBoundedJsonValue(many).success, false);
    assertEquals(snapshotBoundedParsedJsonValue(many, 16 * 1024 * 1024).success, true);
  });
  it("does not count normalized numeric spellings as additional source bytes", () => {
    const source = '{"values":[1e20,1e20,1e20]}';
    assertEquals(
      snapshotBoundedParsedJsonValue(
        JSON.parse(source),
        new TextEncoder().encode(source).byteLength,
      ).success,
      true,
    );
  });
  it("preserves prototype, accessor, cycle, depth, node and key rejection", () => {
    let access = 0;
    const accessor = Object.defineProperty({}, "secret", {
      enumerable: true,
      get() {
        access++;
        return "private";
      },
    });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    let deep: unknown = {};
    for (let index = 0; index < 130; index++) deep = { nested: deep };
    const invalid = [
      Object.create({ inherited: true }),
      accessor,
      cyclic,
      deep,
      Array(100001).fill(null),
      { ["k".repeat(16385)]: true },
      { value: Infinity },
    ];
    for (const input of invalid) {
      assertEquals(snapshotBoundedParsedJsonValue(input, 16 * 1024 * 1024).success, false);
    }
    assertEquals(access, 0);
  });
  it("rejects invalid source budgets and decoded data above the declared source budget", () => {
    for (const budget of [0, -1, Infinity, NaN, 1.5]) {
      assertEquals(snapshotBoundedParsedJsonValue({}, budget).success, false);
    }
    assertEquals(snapshotBoundedParsedJsonValue({ data: "a".repeat(100) }, 50).success, false);
  });
});
