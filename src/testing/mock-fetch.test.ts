import { assertEquals, assertRejects } from "./assert.ts";
import { describe, it } from "./bdd.ts";
import { withMockFetch } from "./mock-fetch.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";

describe("testing/mock-fetch", () => {
  it("rejects invalid mocks before touching global fetch", async () => {
    const originalFetch = globalThis.fetch;
    await assertRejects(() => withMockFetch(42 as never, async () => undefined), TypeError);
    assertEquals(globalThis.fetch, originalFetch);
  });

  it("replaces a malformed global coordinator without executing accessors", async () => {
    const coordinatorKey = Symbol.for("veryfront.testing.mockFetchCoordinator");
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, coordinatorKey);
    const hostileTail = new Proxy({}, {
      get() {
        throw new Error("hostile coordinator accessor");
      },
      getPrototypeOf() {
        throw new Error("hostile coordinator prototype");
      },
    });
    Object.defineProperty(globalThis, coordinatorKey, {
      configurable: true,
      value: { tail: hostileTail, storage: null },
      writable: true,
    });

    try {
      const mockFetch = (() => Promise.resolve(new Response("safe"))) as typeof fetch;
      await withMockFetch(mockFetch, () => {
        assertEquals(globalThis.fetch, mockFetch);
      });
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(globalThis, coordinatorKey, originalDescriptor);
      } else {
        delete (globalThis as Record<PropertyKey, unknown>)[coordinatorKey];
      }
    }
  });

  it("replaces an accessor-backed coordinator sentinel without invoking it", async () => {
    const coordinatorKey = Symbol.for("veryfront.testing.mockFetchCoordinator");
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, coordinatorKey);
    let accessorCalls = 0;
    Object.defineProperty(globalThis, coordinatorKey, {
      configurable: true,
      get() {
        accessorCalls++;
        throw new Error("coordinator accessor must not run");
      },
    });

    try {
      const mockFetch = (() => Promise.resolve(new Response("safe"))) as typeof fetch;
      await withMockFetch(mockFetch, () => {
        assertEquals(globalThis.fetch, mockFetch);
      });
      assertEquals(accessorCalls, 0);
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(globalThis, coordinatorKey, originalDescriptor);
      } else {
        delete (globalThis as Record<PropertyKey, unknown>)[coordinatorKey];
      }
    }
  });

  it("supports nested scopes and restores each enclosing mock", async () => {
    const outerFetch = (() => Promise.resolve(new Response("outer"))) as typeof fetch;
    const innerFetch = (() => Promise.resolve(new Response("inner"))) as typeof fetch;

    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutFailure = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(
        () => reject(new Error("Nested mock fetch scope did not complete")),
        200,
      );
    });
    const nestedRun = withMockFetch(outerFetch, async () => {
      assertEquals(globalThis.fetch, outerFetch);
      const nestedResult = await withMockFetch(innerFetch, async () => {
        assertEquals(globalThis.fetch, innerFetch);
        return "nested";
      });
      assertEquals(globalThis.fetch, outerFetch);
      return nestedResult;
    });

    const result = await Promise.race([nestedRun, timeoutFailure]).finally(() => {
      if (timeout !== undefined) clearTimeout(timeout);
    });

    assertEquals(result, "nested");
  });

  it("serializes overlapping top-level scopes", async () => {
    const calls: string[] = [];
    let releaseFirst: (() => void) | undefined;
    let markFirstStarted: (() => void) | undefined;
    const firstStarted = new Promise<void>((resolve) => markFirstStarted = resolve);
    const firstRelease = new Promise<void>((resolve) => releaseFirst = resolve);

    const firstFetch = (() => Promise.resolve(new Response("first"))) as typeof fetch;
    const secondFetch = (() => Promise.resolve(new Response("second"))) as typeof fetch;
    const first = withMockFetch(firstFetch, async () => {
      calls.push("first-start");
      markFirstStarted?.();
      await firstRelease;
      assertEquals(globalThis.fetch, firstFetch);
      calls.push("first-end");
    });

    await firstStarted;
    const second = withMockFetch(secondFetch, async () => {
      calls.push("second");
      assertEquals(globalThis.fetch, secondFetch);
    });
    await Promise.resolve();
    assertEquals(calls, ["first-start"]);

    releaseFirst?.();
    await Promise.all([first, second]);
    assertEquals(calls, ["first-start", "first-end", "second"]);
  });

  it("waits for nested scopes started by a callback before restoring fetch", async () => {
    const originalFetch = globalThis.fetch;
    const outerFetch = (() => Promise.resolve(new Response("outer"))) as typeof fetch;
    const innerFetch = (() => Promise.resolve(new Response("inner"))) as typeof fetch;
    let releaseInner: (() => void) | undefined;
    let markInnerStarted: (() => void) | undefined;
    const innerStarted = new Promise<void>((resolve) => markInnerStarted = resolve);
    const innerRelease = new Promise<void>((resolve) => releaseInner = resolve);
    let nested: Promise<void> | undefined;
    let outerResolved = false;

    const outer = withMockFetch(outerFetch, async () => {
      nested = withMockFetch(innerFetch, async () => {
        markInnerStarted?.();
        await innerRelease;
        assertEquals(globalThis.fetch, innerFetch);
      });
      await innerStarted;
    }).then(() => {
      outerResolved = true;
    });

    await innerStarted;
    await Promise.resolve();
    assertEquals(outerResolved, false);
    assertEquals(globalThis.fetch, innerFetch);

    releaseInner?.();
    await Promise.all([outer, nested]);
    assertEquals(globalThis.fetch, originalFetch);
  });

  it("restores the original global property descriptor", async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch");
    const originalFetch = globalThis.fetch;
    const getter = () => originalFetch;

    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      enumerable: true,
      get: getter,
    });

    try {
      await withMockFetch(undefined, async () => {
        assertEquals(globalThis.fetch, undefined);
      });

      const restored = Object.getOwnPropertyDescriptor(globalThis, "fetch");
      assertEquals(restored?.get, getter);
      assertEquals(restored?.enumerable, true);
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(globalThis, "fetch", originalDescriptor);
      } else {
        delete (globalThis as { fetch?: typeof fetch }).fetch;
      }
    }
  });

  it("supports writable non-configurable fetch properties", async () => {
    const moduleUrl = new URL("./mock-fetch.ts", import.meta.url).href;
    const script = `
      const { withMockFetch } = await import(${JSON.stringify(moduleUrl)});
      const descriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch");
      if (!descriptor?.configurable) throw new Error("fetch is already non-configurable");
      const originalFetch = globalThis.fetch;
      const mockFetch = () => Promise.resolve(new Response("mock"));
      Object.defineProperty(globalThis, "fetch", {
        configurable: false,
        enumerable: descriptor.enumerable,
        value: originalFetch,
        writable: true,
      });
      await withMockFetch(mockFetch, () => {
        if (globalThis.fetch !== mockFetch) throw new Error("mock was not installed");
      });
      if (globalThis.fetch !== originalFetch) throw new Error("fetch was not restored");
    `;

    if (isDeno) {
      const denoRuntime = (globalThis as { Deno?: typeof Deno }).Deno;
      if (!denoRuntime) throw new Error("Deno runtime API is unavailable");
      const result = await new denoRuntime.Command(denoRuntime.execPath(), {
        args: ["eval", script],
        stderr: "piped",
      }).output();
      if (!result.success) {
        throw new Error(new TextDecoder().decode(result.stderr));
      }
      return;
    }

    const { execFile } = await import("node:child_process");
    const resolver = new URL("../../tests/node/resolver.mjs", import.meta.url).href;
    await new Promise<void>((resolve, reject) => {
      execFile(
        process.execPath,
        ["--import", resolver, "--input-type=module", "-e", script],
        (error, _stdout, stderr) => {
          if (error) reject(new Error(stderr || error.message, { cause: error }));
          else resolve();
        },
      );
    });
  });

  it("restores fetch when the callback rejects", async () => {
    const originalFetch = globalThis.fetch;
    const mockFetch = (() => Promise.resolve(new Response())) as typeof fetch;

    await assertRejects(
      () =>
        withMockFetch(mockFetch, () => {
          throw new Error("expected callback failure");
        }),
      Error,
      "expected callback failure",
    );
    assertEquals(globalThis.fetch, originalFetch);
  });
});
