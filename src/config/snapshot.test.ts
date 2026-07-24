import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  canonicalizeConfigSnapshot,
  CONFIG_SNAPSHOT_LIMITS,
  ConfigSnapshotError,
  type ConfigSnapshotErrorCode,
  type ConfigSnapshotRecord,
  type ConfigSnapshotValue,
} from "./snapshot.ts";

function assertSnapshotError(
  operation: () => unknown,
  code: ConfigSnapshotErrorCode,
): ConfigSnapshotError {
  const error = assertThrows(operation, ConfigSnapshotError) as ConfigSnapshotError;
  assertEquals(error.code, code);
  return error;
}

function asRecord(value: ConfigSnapshotValue): ConfigSnapshotRecord {
  return value as ConfigSnapshotRecord;
}

describe("canonicalizeConfigSnapshot", () => {
  it("creates a detached, deeply frozen canonical snapshot", () => {
    const nullPrototype = Object.create(null) as Record<string, unknown>;
    nullPrototype.z = "last";
    nullPrototype.a = { enabled: true };
    const input = {
      nested: nullPrototype,
      list: [1, { value: "stable" }],
    };

    const snapshot = asRecord(canonicalizeConfigSnapshot(input));
    const nested = asRecord(snapshot.nested!);
    const list = snapshot.list as readonly ConfigSnapshotValue[];
    const listRecord = asRecord(list[1]!);

    assertEquals(snapshot, {
      list: [1, { value: "stable" }],
      nested: { a: { enabled: true }, z: "last" },
    });
    assertEquals(Reflect.ownKeys(nested), ["a", "z"]);
    assertEquals(Object.getPrototypeOf(snapshot), null);
    assertEquals(Object.getPrototypeOf(nested), null);
    assertEquals(Array.isArray(list), true);
    assertEquals(Object.isFrozen(snapshot), true);
    assertEquals(Object.isFrozen(nested), true);
    assertEquals(Object.isFrozen(asRecord(nested.a!)), true);
    assertEquals(Object.isFrozen(list), true);
    assertEquals(Object.isFrozen(listRecord), true);

    nullPrototype.z = "mutated";
    (input.list[1] as { value: string }).value = "mutated";
    assertEquals(nested.z, "last");
    assertEquals(listRecord.value, "stable");
    assertThrows(() => Object.defineProperty(snapshot, "added", { value: true }), TypeError);
    assertThrows(() => Object.defineProperty(list, "0", { value: 2 }), TypeError);
  });

  it("accepts the supported primitive values", () => {
    assertEquals(canonicalizeConfigSnapshot(null), null);
    assertEquals(canonicalizeConfigSnapshot(true), true);
    assertEquals(canonicalizeConfigSnapshot(42.5), 42.5);
    assertEquals(canonicalizeConfigSnapshot("value"), "value");
  });

  it("never invokes getters while rejecting accessor properties", () => {
    let getterCalls = 0;
    const input = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(input, "secret", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "leaked";
      },
    });

    const error = assertSnapshotError(
      () => canonicalizeConfigSnapshot(input),
      "accessor-property",
    );

    assertEquals(getterCalls, 0);
    assertEquals(error.path, '$["secret"]');
  });

  it("builds descriptors safely when Object.prototype is polluted", () => {
    const previous = Object.getOwnPropertyDescriptor(Object.prototype, "get");
    let snapshot: ConfigSnapshotValue | undefined;
    let failure: unknown;
    Object.defineProperty(Object.prototype, "get", {
      configurable: true,
      get() {
        throw new Error("descriptor prototype must not be read");
      },
    });
    try {
      snapshot = canonicalizeConfigSnapshot({
        record: { enabled: true },
        values: ["safe"],
      });
    } catch (error) {
      failure = error;
    } finally {
      if (previous) Object.defineProperty(Object.prototype, "get", previous);
      else delete (Object.prototype as Record<string, unknown>).get;
    }

    if (failure) throw failure;
    assertEquals(snapshot, {
      record: { enabled: true },
      values: ["safe"],
    });
  });

  it("rejects unsupported primitive and numeric values", () => {
    for (const value of [undefined, 1n, Symbol("value"), () => undefined]) {
      assertSnapshotError(
        () => canonicalizeConfigSnapshot(value),
        "unsupported-type",
      );
    }

    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      assertSnapshotError(
        () => canonicalizeConfigSnapshot(value),
        "non-finite-number",
      );
    }

    assertSnapshotError(
      () => canonicalizeConfigSnapshot({ missing: undefined }),
      "unsupported-type",
    );
  });

  it("rejects custom prototypes and class instances", () => {
    class CustomConfig {
      readonly enabled = true;
    }

    for (
      const value of [
        new CustomConfig(),
        new Date(0),
        Object.create({ inherited: true }),
      ]
    ) {
      assertSnapshotError(
        () => canonicalizeConfigSnapshot(value),
        "invalid-prototype",
      );
    }

    class CustomArray<T> extends Array<T> {}
    assertSnapshotError(
      () => canonicalizeConfigSnapshot(new CustomArray("value")),
      "invalid-prototype",
    );
  });

  it("normalizes revoked proxies into the snapshot error contract", () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    assertSnapshotError(
      () => canonicalizeConfigSnapshot(proxy),
      "inspection-failed",
    );
  });

  it("rejects cycles and shared object aliases", () => {
    const cycle = Object.create(null) as Record<string, unknown>;
    cycle.self = cycle;
    assertSnapshotError(
      () => canonicalizeConfigSnapshot(cycle),
      "duplicate-reference",
    );

    const shared = { enabled: true };
    assertSnapshotError(
      () => canonicalizeConfigSnapshot({ first: shared, second: shared }),
      "duplicate-reference",
    );
  });

  it("rejects sparse, extended, and accessor-backed arrays", () => {
    const sparse = new Array<unknown>(2);
    sparse[0] = "value";
    assertSnapshotError(
      () => canonicalizeConfigSnapshot(sparse),
      "invalid-array-shape",
    );

    const extended = ["value"];
    Object.defineProperty(extended, "extra", {
      value: true,
      enumerable: true,
    });
    assertSnapshotError(
      () => canonicalizeConfigSnapshot(extended),
      "invalid-array-shape",
    );

    let getterCalls = 0;
    const accessorArray = new Array<unknown>(1);
    Object.defineProperty(accessorArray, "0", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "value";
      },
    });
    assertSnapshotError(
      () => canonicalizeConfigSnapshot(accessorArray),
      "accessor-property",
    );
    assertEquals(getterCalls, 0);
  });

  it("rejects symbols, hidden properties, and pollution-prone keys", () => {
    const symbolProperty = { safe: true };
    Object.defineProperty(symbolProperty, Symbol("hidden"), {
      value: true,
      enumerable: true,
    });
    assertSnapshotError(
      () => canonicalizeConfigSnapshot(symbolProperty),
      "symbol-key",
    );

    const hiddenProperty = { safe: true };
    Object.defineProperty(hiddenProperty, "hidden", {
      value: true,
      enumerable: false,
    });
    assertSnapshotError(
      () => canonicalizeConfigSnapshot(hiddenProperty),
      "non-enumerable-property",
    );

    for (const key of ["__proto__", "constructor", "prototype"]) {
      const input = Object.create(null) as Record<string, unknown>;
      Object.defineProperty(input, key, {
        value: true,
        enumerable: true,
      });
      assertSnapshotError(
        () => canonicalizeConfigSnapshot(input),
        "dangerous-key",
      );
    }
  });

  it("uses canonical ECMAScript ordering for integer-like keys", () => {
    const input = Object.create(null) as Record<string, unknown>;
    input["10"] = "ten";
    input["2"] = "two";
    input.alpha = "last";

    const snapshot = asRecord(canonicalizeConfigSnapshot(input));
    assertEquals(Reflect.ownKeys(snapshot), ["2", "10", "alpha"]);
  });

  it("enforces depth, array, object, key, and string limits", () => {
    let deeplyNested: unknown = null;
    for (let index = 0; index <= CONFIG_SNAPSHOT_LIMITS.maxDepth; index += 1) {
      deeplyNested = [deeplyNested];
    }
    assertSnapshotError(
      () => canonicalizeConfigSnapshot(deeplyNested),
      "max-depth-exceeded",
    );

    const oversizedArray = new Array<null>(
      CONFIG_SNAPSHOT_LIMITS.maxArrayLength + 1,
    ).fill(null);
    assertSnapshotError(
      () => canonicalizeConfigSnapshot(oversizedArray),
      "max-array-length-exceeded",
    );

    const wideObject = Object.create(null) as Record<string, unknown>;
    for (
      let index = 0;
      index <= CONFIG_SNAPSHOT_LIMITS.maxObjectKeys;
      index += 1
    ) {
      wideObject[`key-${index}`] = null;
    }
    assertSnapshotError(
      () => canonicalizeConfigSnapshot(wideObject),
      "max-object-keys-exceeded",
    );

    const longKeyInput = Object.create(null) as Record<string, unknown>;
    longKeyInput["k".repeat(CONFIG_SNAPSHOT_LIMITS.maxKeyLength + 1)] = true;
    assertSnapshotError(
      () => canonicalizeConfigSnapshot(longKeyInput),
      "max-key-length-exceeded",
    );

    const oversizedString = "s".repeat(
      CONFIG_SNAPSHOT_LIMITS.maxStringLength + 1,
    );
    assertSnapshotError(
      () => canonicalizeConfigSnapshot(oversizedString),
      "max-string-length-exceeded",
    );
  });

  it("bounds total value and property traversal", () => {
    const nodeHeavy = new Array<unknown>();
    for (let index = 0; index < 6; index += 1) {
      nodeHeavy.push(
        new Array<null>(CONFIG_SNAPSHOT_LIMITS.maxArrayLength).fill(null),
      );
    }
    assertSnapshotError(
      () => canonicalizeConfigSnapshot(nodeHeavy),
      "max-nodes-exceeded",
    );

    let propertyHeavy: unknown = null;
    for (let index = 0; index < 9; index += 1) {
      const layer = new Array<unknown>(
        CONFIG_SNAPSHOT_LIMITS.maxArrayLength,
      ).fill(null);
      layer[0] = propertyHeavy;
      propertyHeavy = layer;
    }
    assertSnapshotError(
      () => canonicalizeConfigSnapshot(propertyHeavy),
      "max-properties-exceeded",
    );
  });

  it("bounds the conservative serialized-size estimate", () => {
    const maximumString = "s".repeat(CONFIG_SNAPSHOT_LIMITS.maxStringLength);
    assertSnapshotError(
      () =>
        canonicalizeConfigSnapshot([
          maximumString,
          maximumString,
          maximumString,
        ]),
      "max-estimated-bytes-exceeded",
    );
  });

  it("keeps the fixed security limits immutable", () => {
    assertEquals(Object.isFrozen(CONFIG_SNAPSHOT_LIMITS), true);
    assertThrows(
      () =>
        Object.defineProperty(CONFIG_SNAPSHOT_LIMITS, "maxDepth", {
          value: Number.MAX_SAFE_INTEGER,
        }),
      TypeError,
    );
  });
});
