import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getNativeDeno,
  getNativeDenoFromHost,
  getNativeResponse,
  getNativeResponseFromHost,
  toNativeResponse,
} from "./native-response.ts";

describe("getNativeResponse", () => {
  it("returns the native Response constructor", () => {
    const NativeResponse = getNativeResponse();
    // In Deno, `self` equals `globalThis`, so this is the real Response.
    assertStrictEquals(NativeResponse, Response);
  });

  it("reads Response through the typed host accessor", () => {
    const NativeResponse = getNativeResponseFromHost({ Response });

    assertStrictEquals(NativeResponse, Response);
  });

  it("produces instances that are real Response objects", () => {
    const NativeResponse = getNativeResponse();
    const res = new NativeResponse("hello", { status: 201 });
    assert(res instanceof Response);
    assertEquals(res.status, 201);
  });
});

describe("getNativeDeno", () => {
  it("returns the native Deno namespace in the Deno runtime", () => {
    const nativeDeno = getNativeDeno();
    assertStrictEquals(nativeDeno, Deno);
  });

  it("returns undefined when the typed host has no native Deno namespace", () => {
    assertEquals(getNativeDenoFromHost({}), undefined);
  });

  it("ignores non-object Deno values on the typed host", () => {
    assertEquals(getNativeDenoFromHost({ Deno: "not-deno" }), undefined);
  });

  it("exposes native APIs absent from the dnt shim", () => {
    const nativeDeno = getNativeDeno();
    assert(nativeDeno !== undefined);
    assertEquals(typeof nativeDeno.serve, "function");
    assertEquals(typeof nativeDeno.upgradeWebSocket, "function");
  });
});

describe("toNativeResponse", () => {
  it("returns the same instance when already a native Response", () => {
    const NativeResponse = getNativeResponse();
    const original = new NativeResponse("body", { status: 200 });
    const result = toNativeResponse(original, NativeResponse);
    assertStrictEquals(result, original);
  });

  it("re-wraps a non-native Response preserving status, statusText and headers", async () => {
    const NativeResponse = getNativeResponse();
    // Model the dnt scenario: the runtime `Response` is a *different* constructor
    // than the native one, so the input fails `instanceof NativeResponse` and the
    // re-wrap path runs. We simulate "native" with a distinct subclass.
    class FakeNativeResponse extends Response {}
    const polyfilled = new NativeResponse("payload", {
      status: 202,
      statusText: "Accepted",
      headers: { "x-test": "1" },
    });

    const result = toNativeResponse(
      polyfilled,
      FakeNativeResponse as unknown as typeof Response,
    );

    // Re-wrapped into the supplied "native" constructor.
    assert(result instanceof FakeNativeResponse);
    assertEquals(result.status, 202);
    assertEquals(result.statusText, "Accepted");
    assertEquals(result.headers.get("x-test"), "1");
    assertEquals(await result.text(), "payload");
  });
});
