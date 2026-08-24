import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  findExtensionPropertyDescriptor,
  isDataPropertyDescriptor,
  isStableExtensionCacheIdentity,
} from "./property-inspection.ts";

describe("extension property inspection", () => {
  it("finds inherited data properties without invoking accessors", () => {
    let reads = 0;
    const prototype = Object.create(null);
    Object.defineProperty(prototype, "method", {
      value: () => "ok",
      enumerable: false,
    });
    Object.defineProperty(prototype, "accessor", {
      get() {
        reads++;
        return "wrong";
      },
    });
    const value = Object.create(prototype);

    assertEquals(
      typeof findExtensionPropertyDescriptor(value, "method")?.value,
      "function",
    );
    assertEquals("get" in findExtensionPropertyDescriptor(value, "accessor")!, true);
    assertEquals(reads, 0);
  });

  it("rejects cyclic and excessively deep prototype chains", () => {
    const cyclic: object = new Proxy({}, { getPrototypeOf: () => cyclic });
    assertThrows(
      () => findExtensionPropertyDescriptor(cyclic, "missing"),
      TypeError,
      "invalid prototype chain",
    );

    let deep = Object.create(null);
    for (let index = 0; index < 32; index++) deep = Object.create(deep);
    assertThrows(
      () => findExtensionPropertyDescriptor(deep, "missing"),
      TypeError,
      "invalid prototype chain",
    );
  });

  it("propagates proxy inspection failures without retrying traps", () => {
    let descriptorReads = 0;
    const hostile = new Proxy({}, {
      getOwnPropertyDescriptor() {
        descriptorReads++;
        throw new Error("blocked");
      },
    });

    assertThrows(
      () => findExtensionPropertyDescriptor(hostile, "method"),
      Error,
      "blocked",
    );
    assertEquals(descriptorReads, 1);
  });

  it("does not trust or invoke inherited descriptor values", () => {
    let reads = 0;
    const inheritedValue = Object.create({
      get value() {
        reads++;
        return "hostile";
      },
    }) as PropertyDescriptor;

    assertEquals(isDataPropertyDescriptor(inheritedValue), false);
    assertEquals(isDataPropertyDescriptor({ get: () => "accessor" }), false);
    assertEquals(isDataPropertyDescriptor({ value: undefined }), true);
    assertEquals(reads, 0);
  });

  it("validates well-formed identities without newer String intrinsics", () => {
    assertEquals(isStableExtensionCacheIdentity("engine-v1", 64), true);
    assertEquals(isStableExtensionCacheIdentity("engine-\u{1F680}", 64), true);
    assertEquals(isStableExtensionCacheIdentity("engine-\uD800", 64), false);
    assertEquals(isStableExtensionCacheIdentity("engine-\uDC00", 64), false);
    assertEquals(isStableExtensionCacheIdentity("engine-\uD800x", 64), false);
    assertEquals(
      isStableExtensionCacheIdentity("x".repeat(64), 64),
      true,
      "an identity of exactly maxCharacters must be accepted",
    );
    assertEquals(
      isStableExtensionCacheIdentity("x".repeat(65), 64),
      false,
      "an identity one character over maxCharacters must be rejected",
    );
    // An identity becomes a cache key and a log line, so an interior control
    // character or line separator must be rejected rather than trimmed away.
    assertEquals(
      isStableExtensionCacheIdentity("engine\u0000v1", 64),
      false,
      "an interior NUL must be rejected",
    );
    assertEquals(
      isStableExtensionCacheIdentity("engine\nv1", 64),
      false,
      "an interior newline must be rejected",
    );
    assertEquals(
      isStableExtensionCacheIdentity("engine\u2028v1", 64),
      false,
      "an interior line separator must be rejected",
    );
    assertEquals(
      isStableExtensionCacheIdentity("engine-e\u0301", 64),
      false,
      "a decomposed identity must be rejected so one engine cannot own two keys",
    );
    assertEquals(
      isStableExtensionCacheIdentity("engine-\u00e9", 64),
      true,
      "the composed NFC form of the same identity must be accepted",
    );
  });
});
