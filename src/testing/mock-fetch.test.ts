import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "./mock-fetch.ts";

describe("testing/mock-fetch", () => {
  it("restores the exact original fetch property descriptor", async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch");
    let originalFetch = originalDescriptor?.value as typeof fetch | undefined;
    const getter = () => originalFetch;

    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      enumerable: false,
      get: getter,
    });

    const mock = (() => Promise.resolve(new Response("mock"))) as typeof fetch;
    try {
      await withMockFetch(mock, async () => {
        assertEquals(globalThis.fetch, mock);
      });

      const restored = Object.getOwnPropertyDescriptor(globalThis, "fetch");
      assertEquals(restored?.get, getter);
      assertEquals(restored?.enumerable, false);
      assertEquals("value" in (restored ?? {}), false);
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(globalThis, "fetch", originalDescriptor);
      } else {
        delete (globalThis as { fetch?: typeof fetch }).fetch;
      }
      originalFetch = undefined;
    }
  });
});
