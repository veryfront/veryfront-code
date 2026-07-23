import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { snapshotJsonValue } from "./json-value.ts";

describe("tool JSON snapshots", () => {
  it("creates detached snapshots of plain JSON data", () => {
    const shared = { value: 1 };
    const input = {
      text: "hello",
      enabled: true,
      count: -0,
      nested: [shared, shared, null],
    };

    const snapshot = snapshotJsonValue(input);
    shared.value = 2;

    assertEquals(snapshot, {
      text: "hello",
      enabled: true,
      count: 0,
      nested: [{ value: 1 }, { value: 1 }, null],
    });
  });

  it("preserves null-prototype records and prototype-named keys", () => {
    const input = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(input, "__proto__", {
      value: { safe: true },
      enumerable: true,
    });

    const snapshot = snapshotJsonValue(input);

    assertEquals(Object.getPrototypeOf(snapshot), null);
    assertEquals(snapshot["__proto__"], { safe: true });
  });

  it("rejects unsupported primitive values and non-finite numbers", () => {
    for (const value of [undefined, 1n, Symbol("value"), () => null]) {
      assertThrows(() => snapshotJsonValue(value), TypeError, "values are not supported");
    }
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      assertThrows(() => snapshotJsonValue(value), TypeError, "numbers must be finite");
    }
  });

  it("rejects cycles, exotic objects, proxies, and symbol properties", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    assertThrows(() => snapshotJsonValue(cyclic), TypeError, "cyclic references");
    assertThrows(() => snapshotJsonValue(new Date()), TypeError, "plain objects");

    const withSymbol = { [Symbol("hidden")]: true };
    assertThrows(() => snapshotJsonValue(withSymbol), TypeError, "symbol properties");

    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    assertThrows(
      () => snapshotJsonValue(revoked.proxy),
      TypeError,
      "metadata could not be inspected",
    );
  });

  it("rejects accessors, non-enumerable properties, and malformed arrays", () => {
    const accessor = Object.defineProperty({}, "value", {
      enumerable: true,
      get: () => "hidden",
    });
    assertThrows(() => snapshotJsonValue(accessor), TypeError, "data properties");

    const hidden = Object.defineProperty({}, "value", { value: "hidden" });
    assertThrows(() => snapshotJsonValue(hidden), TypeError, "enumerable data properties");

    const sparse = new Array(2);
    sparse[1] = "value";
    assertThrows(() => snapshotJsonValue(sparse), TypeError, "sparse");

    const custom = ["value"];
    Object.defineProperty(custom, "metadata", { value: true, enumerable: true });
    assertThrows(() => snapshotJsonValue(custom), TypeError, "custom array properties");
  });

  it("enforces configured depth, node, string, key, and byte limits", () => {
    assertThrows(
      () => snapshotJsonValue({ nested: { value: true } }, { maxDepth: 1 }),
      TypeError,
      "nesting depth exceeds 1",
    );
    assertThrows(
      () => snapshotJsonValue([1, 2], { maxNodes: 2 }),
      TypeError,
      "value count exceeds 2",
    );
    assertThrows(
      () => snapshotJsonValue("long", { maxStringLength: 3 }),
      TypeError,
      "string length exceeds 3",
    );
    assertThrows(
      () => snapshotJsonValue({ ["k".repeat(4_097)]: true }),
      TypeError,
      "property name length exceeds 4096",
    );
    assertThrows(
      () => snapshotJsonValue({ value: "long" }, { maxBytes: 5 }),
      TypeError,
      "serialized size exceeds 5 bytes",
    );
  });

  it("stops traversal as soon as the cumulative byte budget is exhausted", () => {
    let hostileReads = 0;
    const hostile = new Proxy({}, {
      getPrototypeOf() {
        hostileReads += 1;
        throw new Error("hostile child inspected");
      },
    });

    assertThrows(
      () =>
        snapshotJsonValue(
          { first: "0123456789", later: hostile },
          { maxBytes: 16 },
        ),
      TypeError,
      "serialized size exceeds 16 bytes",
    );
    assertEquals(hostileReads, 0);
  });

  it("rejects invalid snapshot limits before traversal", () => {
    for (
      const options of [
        { maxDepth: 0 },
        { maxNodes: Number.NaN },
        { maxBytes: -1 },
        { maxStringLength: 1.5 },
      ]
    ) {
      assertThrows(() => snapshotJsonValue({}, options), RangeError, "safe integer");
    }
  });
});
