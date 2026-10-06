import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  drainSharedInitialization,
  isSharedInitializationAborted,
  joinSharedInitialization,
  startSharedInitialization,
} from "#veryfront/platform/adapters/shared-initialization.ts";

describe("shared initialization intrinsic integration", () => {
  it("uses the captured Promise constructor for abortable join and drain wrappers", async () => {
    const nativePromise = Promise;
    const joinController = new AbortController();
    const drainController = new AbortController();
    const drain = nativePromise.withResolvers<void>();
    const flight = startSharedInitialization(() => drain.promise);
    let intercepted = 0;
    let joined: Promise<void> | undefined;
    let drained: Promise<void> | undefined;
    try {
      globalThis.Promise = class extends nativePromise<unknown> {
        constructor(
          executor: (
            resolve: (value: unknown) => void,
            reject: (reason?: unknown) => void,
          ) => void,
        ) {
          intercepted++;
          super(executor);
        }
      } as PromiseConstructor;

      joined = joinSharedInitialization(flight, joinController.signal);
      drained = drainSharedInitialization(flight, drainController.signal);
      assertEquals(intercepted, 0);
      joinController.abort();
      drainController.abort();
    } finally {
      globalThis.Promise = nativePromise;
    }

    await assertRejects(() => joined!, Error);
    await assertRejects(() => drained!, Error);
    drain.resolve();
    await drainSharedInitialization(flight);
    assertEquals(flight.waiters, 0);
    assertEquals(flight.settled, true);
  });

  it("uses captured abort intrinsics after project code replaces ambient hooks", async () => {
    const controller = new AbortController();
    const signal = controller.signal;
    const nativeController = AbortController;
    const nativeAbort = AbortController.prototype.abort;
    const originals = [
      [AbortController.prototype, "signal"],
      [AbortController.prototype, "abort"],
      [AbortSignal.prototype, "aborted"],
      [AbortSignal.prototype, "reason"],
      [EventTarget.prototype, "addEventListener"],
      [EventTarget.prototype, "removeEventListener"],
    ] as const;
    const descriptors = originals.map(([owner, key]) =>
      Object.getOwnPropertyDescriptor(owner, key)!
    );
    const drain = Promise.withResolvers<void>();
    let intercepted = 0;
    const poison = () => {
      intercepted++;
      throw new Error("project abort hook");
    };
    let waiter: Promise<void> | undefined;
    try {
      globalThis.AbortController = class extends nativeController {
        constructor() {
          super();
          poison();
        }
      };
      for (const [owner, key] of originals) {
        Object.defineProperty(owner, key, {
          configurable: true,
          ...(key === "signal" || key === "aborted" || key === "reason"
            ? { get: poison }
            : { value: poison, writable: true }),
        });
      }
      const flight = startSharedInitialization(() => drain.promise);
      waiter = joinSharedInitialization(flight, signal);
      assertEquals(isSharedInitializationAborted(flight), false);
      // Deno's native abort implementation itself reads public signal getters.
      // Restore those for the external caller after exercising the helper's
      // captured getters; constructor and listener hooks stay replaced.
      originals.forEach(([owner, key], index) => {
        if (key === "signal" || key === "aborted" || key === "reason") {
          Object.defineProperty(owner, key, descriptors[index]!);
        }
      });
      const rejection = assertRejects(() => waiter!, Error);
      Reflect.apply(nativeAbort, controller, []);
      assertEquals(isSharedInitializationAborted(flight), true);
      drain.resolve();
      await rejection;
      assertEquals(intercepted, 0);
      assertEquals(flight.waiters, 0);
    } finally {
      globalThis.AbortController = nativeController;
      originals.forEach(([owner, key], index) =>
        Object.defineProperty(owner, key, descriptors[index]!)
      );
      drain.resolve();
      await waiter?.catch(() => {});
    }
  });
});
