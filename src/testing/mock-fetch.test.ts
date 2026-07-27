import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "./mock-fetch.ts";

describe("testing/mock-fetch", () => {
  it("supports nested fetch mocks without deadlocking and restores the outer mock", {
    timeout: 500,
  }, async () => {
    const outerMock = (() => Promise.resolve(new Response("outer"))) as typeof fetch;
    const innerMock = (() => Promise.resolve(new Response("inner"))) as typeof fetch;
    const observed: Array<typeof fetch | undefined> = [];

    await withMockFetch(outerMock, async () => {
      observed.push(globalThis.fetch);

      await withMockFetch(innerMock, async () => {
        observed.push(globalThis.fetch);
      });

      observed.push(globalThis.fetch);
    });

    assertEquals(observed, [outerMock, innerMock, outerMock]);
  });

  it("serializes independent concurrent fetch mocks", async () => {
    const firstMock = (() => Promise.resolve(new Response("first"))) as typeof fetch;
    const secondMock = (() => Promise.resolve(new Response("second"))) as typeof fetch;
    const observed: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = withMockFetch(firstMock, async () => {
      observed.push("first:enter");
      await firstGate;
      observed.push("first:exit");
    });

    await Promise.resolve();
    const second = withMockFetch(secondMock, () => {
      observed.push("second:enter");
    });

    // Give the second scope a continuation turn. It must remain queued while
    // the first scope owns the process-global fetch descriptor.
    await Promise.resolve();
    assertEquals(observed, ["first:enter"]);
    assertEquals(globalThis.fetch, firstMock);

    releaseFirst?.();
    await Promise.all([first, second]);

    assertEquals(observed, ["first:enter", "first:exit", "second:enter"]);
  });

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
