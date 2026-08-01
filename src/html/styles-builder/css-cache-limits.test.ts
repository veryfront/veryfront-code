import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { CacheValueTooLargeError } from "#veryfront/cache/bounded-read.ts";
import {
  assertCSSSerializedCacheValue,
  ByteWeightedLRUCache,
  detachRetainedString,
  estimateRetainedStringBytes,
  MAX_CSS_SERIALIZED_CACHE_ENTRY_BYTES,
  serializeCSSCacheValue,
} from "./css-cache-limits.ts";
import {
  MAX_CSS_OUTPUT_FILE_BYTES,
  MAX_CSS_SELECTOR_EVIDENCE_BYTES,
  MAX_CSS_SELECTOR_TOKENS,
} from "#veryfront/utils/constants/css.ts";

describe("styles-builder/css-cache-limits", () => {
  it("reconstructs retained strings without changing any UTF-16 code unit", () => {
    const middle = `${"x".repeat(20_000)}\u{1f642}\ud800X\udc00\udfff`;
    const parent = `prefix:${middle}:suffix`;
    const sliced = parent.slice(7, -7);
    const detached = detachRetainedString(sliced);

    assertEquals(detached, sliced);
    assertEquals(detached.length, sliced.length);
    for (let index = 0; index < sliced.length; index++) {
      assertEquals(detached.charCodeAt(index), sliced.charCodeAt(index));
    }
    assertEquals(estimateRetainedStringBytes(detached), estimateRetainedStringBytes(sliced));
    assertEquals(detachRetainedString(""), "");
  });

  it("accounts for every possible leaf and rope node in a chunked detached string", () => {
    const oneChunk = "x".repeat(8 * 1024);
    const twoChunks = `${oneChunk}x`;
    const oneChunkOverhead = estimateRetainedStringBytes(oneChunk) - oneChunk.length * 2;
    const twoChunkOverhead = estimateRetainedStringBytes(twoChunks) - twoChunks.length * 2;

    assertEquals(twoChunkOverhead >= oneChunkOverhead * 5, true);
  });

  it("tracks exact retained bytes across inserts and replacements", () => {
    const cache = new ByteWeightedLRUCache<string, string>({
      maxEntries: 3,
      maxEntrySizeBytes: 10,
      maxSizeBytes: 12,
    });

    assertEquals(cache.set("a", "first", 4), true);
    assertEquals(cache.size, 1);
    assertEquals(cache.sizeBytes, 4);

    assertEquals(cache.set("a", "replacement", 6), true);
    assertEquals(cache.size, 1);
    assertEquals(cache.sizeBytes, 6);
    assertEquals(cache.peek("a"), "replacement");
  });

  it("touches reads and performs every eviction needed by byte pressure", () => {
    const cache = new ByteWeightedLRUCache<string, string>({
      maxEntries: 5,
      maxEntrySizeBytes: 10,
      maxSizeBytes: 10,
    });
    cache.set("a", "A", 3);
    cache.set("b", "B", 3);
    cache.set("c", "C", 3);
    assertEquals(cache.get("a"), "A");

    assertEquals(cache.set("d", "D", 7), true);
    assertEquals(cache.peek("a"), "A");
    assertEquals(cache.peek("b"), undefined);
    assertEquals(cache.peek("c"), undefined);
    assertEquals(cache.peek("d"), "D");
    assertEquals(cache.size, 2);
    assertEquals(cache.sizeBytes, 10);
  });

  it("evicts a legitimate undefined key", () => {
    const cache = new ByteWeightedLRUCache<string | undefined, string>({
      maxEntries: 1,
      maxEntrySizeBytes: 10,
      maxSizeBytes: 10,
    });
    assertEquals(cache.set(undefined, "first", 5), true);

    assertEquals(cache.set("second", "second", 5), true);
    assertEquals([...cache.keys()], ["second"]);
    assertEquals(cache.sizeBytes, 5);
  });

  it("removes an existing value when its oversized replacement is rejected", () => {
    const cache = new ByteWeightedLRUCache<string, string>({
      maxEntries: 2,
      maxEntrySizeBytes: 5,
      maxSizeBytes: 10,
    });
    cache.set("a", "admitted", 4);

    assertEquals(cache.set("a", "oversized", 6), false);
    assertEquals(cache.peek("a"), undefined);
    assertEquals(cache.size, 0);
    assertEquals(cache.sizeBytes, 0);
  });

  it("keeps entry and byte counts synchronized through delete and clear", () => {
    const cache = new ByteWeightedLRUCache<string, string>({
      maxEntries: 3,
      maxEntrySizeBytes: 10,
      maxSizeBytes: 20,
    });
    cache.set("a", "A", 2);
    cache.set("b", "B", 3);

    assertEquals(cache.delete("missing"), false);
    assertEquals(cache.sizeBytes, 5);
    assertEquals(cache.delete("a"), true);
    assertEquals(cache.size, 1);
    assertEquals(cache.sizeBytes, 3);

    cache.clear();
    assertEquals(cache.size, 0);
    assertEquals(cache.sizeBytes, 0);
    assertEquals(cache.peek("b"), undefined);
  });

  it("rejects invalid limits and entry weights without drifting accounting", () => {
    assertThrows(
      () =>
        new ByteWeightedLRUCache({
          maxEntries: -1,
          maxEntrySizeBytes: 1,
          maxSizeBytes: 1,
        }),
      RangeError,
      "maxEntries",
    );
    assertThrows(
      () =>
        new ByteWeightedLRUCache({
          maxEntries: 1,
          maxEntrySizeBytes: 2,
          maxSizeBytes: 1,
        }),
      RangeError,
      "cannot exceed",
    );

    const cache = new ByteWeightedLRUCache<string, string>({
      maxEntries: 1,
      maxEntrySizeBytes: 5,
      maxSizeBytes: 5,
    });
    cache.set("a", "A", 3);
    assertThrows(() => cache.set("a", "invalid", -1), RangeError, "sizeBytes");
    assertThrows(() => cache.set("a", "invalid", 1.5), RangeError, "sizeBytes");
    assertEquals(cache.peek("a"), "A");
    assertEquals(cache.size, 1);
    assertEquals(cache.sizeBytes, 3);
  });

  it("budgets CSS, candidate evidence, stylesheet, separators, and framing", () => {
    assertEquals(
      MAX_CSS_SERIALIZED_CACHE_ENTRY_BYTES,
      MAX_CSS_OUTPUT_FILE_BYTES + MAX_CSS_SELECTOR_EVIDENCE_BYTES +
        MAX_CSS_OUTPUT_FILE_BYTES + MAX_CSS_SELECTOR_TOKENS * 3 +
        JSON.stringify({ css: "", candidates: [], stylesheet: "" }).length,
    );
  });

  it("checks the serialized UTF-8 envelope rather than source code units", () => {
    assertEquals(serializeCSSCacheValue({ value: "é" }, 14), '{"value":"é"}');
    assertThrows(
      () => serializeCSSCacheValue({ value: "é" }, 13),
      CacheValueTooLargeError,
    );
    assertThrows(
      () => assertCSSSerializedCacheValue("é", 1),
      CacheValueTooLargeError,
    );
  });

  it("rejects escape-expanded JSON before JSON.stringify can allocate it", () => {
    const nativeStringify = JSON.stringify;
    let stringifyCalls = 0;
    JSON.stringify = ((...args: Parameters<typeof JSON.stringify>) => {
      stringifyCalls++;
      return nativeStringify(...args);
    }) as typeof JSON.stringify;

    try {
      assertThrows(
        () => serializeCSSCacheValue({ value: "\0".repeat(10_000) }, 1_000),
        CacheValueTooLargeError,
      );
      assertEquals(stringifyCalls, 0);
    } finally {
      JSON.stringify = nativeStringify;
    }
  });

  it("preflights JSON escapes, lone surrogates, and scalar pairs at the exact boundary", () => {
    const value = { value: '"\0\ud800😀' };
    const expected = '{"value":"\\"\\u0000\\ud800😀"}';

    assertEquals(serializeCSSCacheValue(value, 30), expected);
    assertThrows(
      () => serializeCSSCacheValue(value, 29),
      CacheValueTooLargeError,
    );
  });

  it("rejects toJSON hooks without invoking them", () => {
    let hookCalls = 0;
    const value = { value: "safe" };
    Object.defineProperty(value, "toJSON", {
      configurable: true,
      value() {
        hookCalls++;
        return { value: "\0".repeat(10_000) };
      },
    });

    assertThrows(
      () => serializeCSSCacheValue(value, 100),
      TypeError,
      "toJSON",
    );
    assertEquals(hookCalls, 0);
  });

  it("rejects inherited sparse-array values before invoking accessors or JSON.stringify", () => {
    const nativeStringify = JSON.stringify;
    const inheritedIndex = "64";
    const value: unknown[] = [];
    value.length = Number(inheritedIndex) + 1;
    let getterCalls = 0;
    let stringifyCalls = 0;
    Object.defineProperty(Array.prototype, inheritedIndex, {
      configurable: true,
      get() {
        getterCalls++;
        return "x".repeat(10_000);
      },
    });
    JSON.stringify = ((...args: Parameters<typeof JSON.stringify>) => {
      stringifyCalls++;
      return nativeStringify(...args);
    }) as typeof JSON.stringify;

    try {
      assertThrows(
        () => serializeCSSCacheValue(value, 500),
        TypeError,
        "must not inherit indexed properties",
      );
      assertEquals(getterCalls, 0);
      assertEquals(stringifyCalls, 0);
    } finally {
      JSON.stringify = nativeStringify;
      delete (Array.prototype as unknown as Record<string, unknown>)[inheritedIndex];
    }
  });

  it("rejects Proxy prototype chains without invoking their traps", () => {
    let trapCalls = 0;
    const prototype = new Proxy({}, {
      getOwnPropertyDescriptor() {
        trapCalls++;
        throw new Error("proxy trap must not run");
      },
      getPrototypeOf() {
        trapCalls++;
        throw new Error("proxy trap must not run");
      },
    });
    const value = Object.assign(Object.create(prototype), { value: "safe" });

    assertThrows(
      () => serializeCSSCacheValue(value, 100),
      TypeError,
      "Proxy",
    );
    assertEquals(trapCalls, 0);
  });
});
