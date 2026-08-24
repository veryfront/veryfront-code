import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import {
  getNativeDeno,
  getNativeResponse,
} from "#veryfront/platform/compat/http/native-response.ts";

// Swapping globalThis.self is a host mutation the unit boundary forbids, so the
// self-versus-globalThis lookup is exercised here.
describe("integration/runtime/compat/native-response-host", () => {
  it("reads the native host from self and falls back to globalThis", () => {
    const selfDescriptor = Object.getOwnPropertyDescriptor(globalThis, "self");
    if (!selfDescriptor) return;
    class FakeResponse {}
    try {
      Object.defineProperty(globalThis, "self", {
        value: { Response: FakeResponse, Deno: undefined },
        configurable: true,
        writable: true,
      });
      assertStrictEquals(
        getNativeResponse() as unknown,
        FakeResponse,
        "the native host is read from self, not globalThis",
      );
      assertEquals(getNativeDeno(), undefined, "the Deno namespace is read from the same host");

      delete (globalThis as Record<string, unknown>).self;
      assertStrictEquals(
        getNativeResponse(),
        Response,
        "globalThis is used only when self is undefined",
      );
    } finally {
      Object.defineProperty(globalThis, "self", selfDescriptor);
    }
  });
});
