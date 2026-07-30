import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertNotStrictEquals,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { DataResult } from "./types.ts";
import {
  captureCacheableDataResult,
  cloneCapturedDataResult,
  getCapturedDataResultBytes,
} from "./cache-result-snapshot.ts";
import {
  MAX_DATA_CACHE_SNAPSHOT_BYTES,
  MAX_DATA_CACHE_SNAPSHOT_DEPTH,
  MAX_DATA_CACHE_SNAPSHOT_NODES,
} from "./data-limits.ts";

describe("cache result snapshots", () => {
  it("captures one immutable graph and gives every caller a detached graph", () => {
    const shared = { value: "original" };
    const props = Object.create(null) as Record<string, unknown>;
    props.shared = shared;
    props.alias = shared;
    props.list = [shared, undefined, Number.NaN];
    props.self = props;
    Object.defineProperty(props, "__proto__", {
      configurable: true,
      enumerable: true,
      value: "data",
      writable: true,
    });

    const captured = captureCacheableDataResult({
      props,
      revalidate: false,
    });
    const first = cloneCapturedDataResult(captured);
    const second = cloneCapturedDataResult(captured);
    const firstProps = first.props as Record<string, unknown>;
    const secondProps = second.props as Record<string, unknown>;

    assertEquals(Object.isFrozen(captured), true);
    assertEquals(Object.isFrozen(captured.props), true);
    assertEquals((firstProps.shared as { value: string }).value, "original");
    assertStrictEquals(firstProps.shared, firstProps.alias);
    assertStrictEquals(firstProps.self, firstProps);
    assertStrictEquals(secondProps.self, secondProps);
    assertNotStrictEquals(firstProps, secondProps);
    assertNotStrictEquals(firstProps.shared, secondProps.shared);
    assertEquals(Object.getPrototypeOf(firstProps), null);
    assertEquals(firstProps.__proto__, "data");

    const retainedBytes = getCapturedDataResultBytes(captured as object);
    (firstProps.shared as { value: string }).value = "mutated";
    assertEquals(
      getCapturedDataResultBytes(captured as object),
      retainedBytes,
    );
    assertEquals((secondProps.shared as { value: string }).value, "original");
    assertEquals(
      (cloneCapturedDataResult(captured).props as {
        shared: { value: string };
      }).shared.value,
      "original",
    );
    assertEquals(typeof retainedBytes, "number");
    assertEquals((retainedBytes ?? 0) > 0, true);
  });

  it("rejects values that cannot be retained as plain detached data", () => {
    let accessorReads = 0;
    const accessor = Object.defineProperty({}, "value", {
      enumerable: true,
      get() {
        accessorReads++;
        return "secret";
      },
    });
    const customPrototype = Object.create({ inherited: true });
    const sparse = new Array(2);
    sparse[1] = "present";
    const arrayWithProperty = ["value"] as unknown[] & { extra?: string };
    arrayWithProperty.extra = "extra";
    const proxyTrapReads = { prototype: 0, keys: 0, descriptors: 0 };
    const proxy = new Proxy({ value: true }, {
      getPrototypeOf(target) {
        proxyTrapReads.prototype++;
        return Reflect.getPrototypeOf(target);
      },
      ownKeys(target) {
        proxyTrapReads.keys++;
        return Reflect.ownKeys(target);
      },
      getOwnPropertyDescriptor(target, key) {
        proxyTrapReads.descriptors++;
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });

    const invalidValues: unknown[] = [
      () => "closure",
      Symbol("symbol"),
      1n,
      new Date(),
      /regexp/,
      new Map([["key", "value"]]),
      new Set(["value"]),
      new Uint8Array([1]),
      accessor,
      customPrototype,
      sparse,
      arrayWithProperty,
      proxy,
    ];
    for (const value of invalidValues) {
      assertThrows(
        () => captureCacheableDataResult({ props: { value } }),
        TypeError,
        "Cached static data must contain only primitives",
      );
    }
    assertEquals(accessorReads, 0);
    assertEquals(proxyTrapReads, { prototype: 0, keys: 0, descriptors: 0 });
  });

  it("accepts each exact snapshot boundary and rejects the next value", () => {
    const nested = (records: number): unknown => {
      let value: unknown = null;
      for (let depth = 0; depth < records; depth++) value = { child: value };
      return value;
    };

    captureCacheableDataResult({
      props: nested(MAX_DATA_CACHE_SNAPSHOT_DEPTH - 1),
    });
    assertThrows(
      () =>
        captureCacheableDataResult({
          props: nested(MAX_DATA_CACHE_SNAPSHOT_DEPTH),
        }),
      RangeError,
      `depth limit of ${MAX_DATA_CACHE_SNAPSHOT_DEPTH}`,
    );

    captureCacheableDataResult({
      props: Array.from(
        { length: MAX_DATA_CACHE_SNAPSHOT_NODES - 2 },
        () => null,
      ),
    });
    assertThrows(
      () =>
        captureCacheableDataResult({
          props: Array.from(
            { length: MAX_DATA_CACHE_SNAPSHOT_NODES - 1 },
            () => null,
          ),
        }),
      RangeError,
      `node limit of ${MAX_DATA_CACHE_SNAPSHOT_NODES.toLocaleString("en-US")}`,
    );

    // Root record (32), `props` property (18), and string header (16) leave
    // exactly the remaining even byte count for UTF-16 string contents.
    const exactStringLength = (MAX_DATA_CACHE_SNAPSHOT_BYTES - 66) / 2;
    const exactBytes = captureCacheableDataResult({
      props: "x".repeat(exactStringLength),
    });
    assertEquals(
      getCapturedDataResultBytes(exactBytes as object),
      MAX_DATA_CACHE_SNAPSHOT_BYTES,
    );
    assertEquals(
      (cloneCapturedDataResult(exactBytes).props as string).length,
      exactStringLength,
    );
    assertThrows(
      () =>
        captureCacheableDataResult({
          props: "x".repeat(exactStringLength + 1),
        }),
      RangeError,
      `byte limit of ${MAX_DATA_CACHE_SNAPSHOT_BYTES.toLocaleString("en-US")}`,
    );
  });

  it("preserves validated static control and revalidation scalar values", () => {
    for (
      const result of [
        { notFound: true },
        { props: {}, notFound: false },
        { props: {}, revalidate: false },
        { props: {}, revalidate: 0 },
        { props: {}, revalidate: 0.25 },
      ] satisfies DataResult[]
    ) {
      assertEquals(
        cloneCapturedDataResult(captureCacheableDataResult(result)),
        result,
      );
    }
  });
});
