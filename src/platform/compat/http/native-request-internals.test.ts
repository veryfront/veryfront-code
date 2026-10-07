import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { lockNativeRequestInternals, lockSymbolMembers } from "./native-request-internals.ts";

function symbolMember(target: object, description: string): PropertyDescriptor | undefined {
  const key = Object.getOwnPropertySymbols(target).find((symbol) =>
    symbol.description === description
  );
  return key === undefined ? undefined : Object.getOwnPropertyDescriptor(target, key);
}

describe("platform/compat/http/native-request-internals", () => {
  it("detects Deno and locks the internals Deno's own accessors reach", {
    // Checked against a signal runtime.ts does not use, so a future Deno that
    // runtime.ts misdetects (which would skip the lock) fails here.
    ignore: !(globalThis.navigator?.userAgent ?? "").startsWith("Deno/"),
  }, () => {
    assertEquals(isDeno, true);
    lockNativeRequestInternals();

    const requestHeaders = symbolMember(Request.prototype, "headers");
    const iterableHeaders = symbolMember(Headers.prototype, "iterable headers");
    assert(requestHeaders !== undefined, "Request.prototype[Symbol(headers)] is missing");
    assert(iterableHeaders !== undefined, "Headers.prototype[Symbol(iterable headers)] is missing");
    assertEquals(requestHeaders.configurable, false);
    assertEquals(iterableHeaders.configurable, false);
  });

  it("makes a non-configurable but writable member read-only", () => {
    const internal = Symbol("internal");
    const accessor = Symbol("accessor");
    const target = {};
    Object.defineProperty(target, internal, {
      value: "original",
      configurable: false,
      writable: true,
    });
    Object.defineProperty(target, accessor, { get: () => "original", configurable: true });

    lockSymbolMembers(target);

    const data = Object.getOwnPropertyDescriptor(target, internal)!;
    assertEquals(data.configurable, false);
    assertEquals(data.writable, false);
    assertEquals(Object.getOwnPropertyDescriptor(target, accessor)!.configurable, false);
    assertEquals(Reflect.set(target, internal, "replaced"), false);
    assertEquals((target as Record<symbol, unknown>)[internal], "original");
  });

  it("leaves well-known symbol members alone", () => {
    const target = {};
    Object.defineProperty(target, Symbol.iterator, {
      value: function* () {},
      configurable: true,
      writable: true,
    });

    lockSymbolMembers(target);

    assertEquals(Object.getOwnPropertyDescriptor(target, Symbol.iterator)!.configurable, true);
  });
});
