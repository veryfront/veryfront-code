import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { runtimeProcess } from "#veryfront/platform/compat/process/runtime-process.ts";
import { isNode } from "#veryfront/platform/compat/runtime.ts";
import { installUnhandledRejectionGuard } from "#veryfront/server/unhandled-rejection-guard.ts";

interface RecordedLog {
  message: string;
  context: Record<string, unknown>;
}

/** Event target that records listeners so a test can dispatch synthetically. */
function createFakeTarget() {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  return {
    addEventListener(type: string, listener: (event: unknown) => void): void {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener(type: string, listener: (event: unknown) => void): void {
      listeners.get(type)?.delete(listener);
    },
    listenerCount(type: string): number {
      return listeners.get(type)?.size ?? 0;
    },
    dispatch(type: string, event: unknown): void {
      for (const listener of listeners.get(type) ?? []) listener(event);
    },
  };
}

function createFakeLogger() {
  const errors: RecordedLog[] = [];
  return {
    errors,
    error(message: string, context?: Record<string, unknown>): void {
      errors.push({ message, context: context ?? {} });
    },
  };
}

function rejectionEvent(reason: unknown) {
  let prevented = false;
  return {
    reason,
    preventDefault(): void {
      prevented = true;
    },
    get prevented(): boolean {
      return prevented;
    },
  };
}

describe("server/unhandled-rejection-guard", () => {
  it({
    name: "installs one lease-shared listener on the real Node process",
    skip: !isNode,
  }, () => {
    assertExists(runtimeProcess);
    const logger = createFakeLogger();
    const eventType = "unhandledRejection";
    const originalListeners = runtimeProcess.listeners(eventType);
    const originalListenerSet = new Set(originalListeners);
    const first = installUnhandledRejectionGuard({ logger });
    const second = installUnhandledRejectionGuard({ logger });

    try {
      assertEquals(first.installed, true);
      assertEquals(second.installed, true);
      assertEquals(runtimeProcess.listenerCount(eventType), originalListeners.length + 1);

      const listener = runtimeProcess.listeners(eventType).find((candidate) =>
        !originalListenerSet.has(candidate)
      );
      assertExists(listener);
      listener(new Error("HTTP client disconnected"), Promise.resolve());

      assertEquals(first.getRejectionCount(), 1);
      assertEquals(second.getRejectionCount(), 1);
      assertEquals(logger.errors.length, 1);
      assertStringIncludes(String(logger.errors[0]?.context.error), "HTTP client disconnected");

      first.dispose();
      assertEquals(runtimeProcess.listenerCount(eventType), originalListeners.length + 1);
      second.dispose();
      assertEquals(runtimeProcess.listenerCount(eventType), originalListeners.length);
    } finally {
      first.dispose();
      second.dispose();
    }
  });

  it("subscribes to unhandled rejections on the process", () => {
    const target = createFakeTarget();
    const guard = installUnhandledRejectionGuard({ target, logger: createFakeLogger() });

    assertEquals(guard.installed, true);
    assertEquals(target.listenerCount("unhandledrejection"), 1);
  });

  it("keeps the process alive instead of letting one rejection kill it", () => {
    const target = createFakeTarget();
    installUnhandledRejectionGuard({ target, logger: createFakeLogger() });

    // The production failure: one tenant's unresolvable CSS import rejected in a
    // background task and terminated a server shared by every other tenant.
    const event = rejectionEvent(
      new Error('ext-css-tailwind cannot resolve stylesheet import "tw-animate-css"'),
    );
    target.dispatch("unhandledrejection", event);

    assertEquals(event.prevented, true);
  });

  it("logs at error with the message and stack so the cause stays visible", () => {
    const target = createFakeTarget();
    const logger = createFakeLogger();
    installUnhandledRejectionGuard({ target, logger });

    const reason = new Error("cannot resolve stylesheet import");
    target.dispatch("unhandledrejection", rejectionEvent(reason));

    assertEquals(logger.errors.length, 1);
    const [logged] = logger.errors;
    assertExists(logged);
    assertStringIncludes(String(logged.context.error), "cannot resolve stylesheet import");
    assertExists(logged.context.stack);
  });

  it("reports a non-Error rejection reason rather than dropping it", () => {
    const target = createFakeTarget();
    const logger = createFakeLogger();
    installUnhandledRejectionGuard({ target, logger });

    target.dispatch("unhandledrejection", rejectionEvent("bare string reason"));

    assertEquals(logger.errors.length, 1);
    const [logged] = logger.errors;
    assertExists(logged);
    assertStringIncludes(String(logged.context.error), "bare string reason");
  });

  it("counts rejections so a rising rate is observable", () => {
    const target = createFakeTarget();
    const guard = installUnhandledRejectionGuard({ target, logger: createFakeLogger() });

    assertEquals(guard.getRejectionCount(), 0);
    target.dispatch("unhandledrejection", rejectionEvent(new Error("one")));
    target.dispatch("unhandledrejection", rejectionEvent(new Error("two")));
    assertEquals(guard.getRejectionCount(), 2);
  });

  it("stops handling once disposed, so shutdown releases the process", () => {
    const target = createFakeTarget();
    const logger = createFakeLogger();
    const guard = installUnhandledRejectionGuard({ target, logger });

    guard.dispose();

    assertEquals(target.listenerCount("unhandledrejection"), 0);
    const event = rejectionEvent(new Error("after dispose"));
    target.dispatch("unhandledrejection", event);
    assertEquals(logger.errors.length, 0);
    assertEquals(event.prevented, false);
  });

  it("is idempotent on dispose", () => {
    const target = createFakeTarget();
    const guard = installUnhandledRejectionGuard({ target, logger: createFakeLogger() });

    guard.dispose();
    guard.dispose();

    assertEquals(target.listenerCount("unhandledrejection"), 0);
  });

  it("logs each rejection once when two guards are installed", () => {
    // Two server instances in one process must not double-report.
    const target = createFakeTarget();
    const logger = createFakeLogger();
    const first = installUnhandledRejectionGuard({ target, logger });
    const second = installUnhandledRejectionGuard({ target, logger });

    target.dispatch("unhandledrejection", rejectionEvent(new Error("once")));

    assertEquals(logger.errors.length, 1);
    assertEquals(target.listenerCount("unhandledrejection"), 1);
    first.dispose();
    second.dispose();
  });

  it("keeps guarding while a second server is still running", () => {
    // Two servers in one process, the first stops first. Ownership by "whoever
    // installed it" removed the only listener here and left the surviving
    // server unguarded again.
    const target = createFakeTarget();
    const logger = createFakeLogger();
    const first = installUnhandledRejectionGuard({ target, logger });
    const second = installUnhandledRejectionGuard({ target, logger });

    first.dispose();

    assertEquals(target.listenerCount("unhandledrejection"), 1);
    const event = rejectionEvent(new Error("after the first server stopped"));
    target.dispatch("unhandledrejection", event);
    assertEquals(event.prevented, true);
    assertEquals(logger.errors.length, 1);

    second.dispose();
    assertEquals(target.listenerCount("unhandledrejection"), 0);
  });

  it("counts rejections across every holder of the guard", () => {
    const target = createFakeTarget();
    const first = installUnhandledRejectionGuard({ target, logger: createFakeLogger() });
    const second = installUnhandledRejectionGuard({ target, logger: createFakeLogger() });

    target.dispatch("unhandledrejection", rejectionEvent(new Error("one")));

    // The count is a process-level metric, so both handles report it.
    assertEquals(first.getRejectionCount(), 1);
    assertEquals(second.getRejectionCount(), 1);
    first.dispose();
    second.dispose();
  });

  it("prevents the default before it formats or logs anything", () => {
    // A reason whose toString throws must not defeat suppression: formatting
    // runs after preventDefault, and diagnostics cannot escape the listener.
    const target = createFakeTarget();
    const logger = createFakeLogger();
    installUnhandledRejectionGuard({ target, logger });

    const hostile = {
      toString(): string {
        throw new Error("conversion failed");
      },
    };
    const event = rejectionEvent(hostile);
    target.dispatch("unhandledrejection", event);

    assertEquals(event.prevented, true);
  });

  it("survives a logger that throws", () => {
    const target = createFakeTarget();
    installUnhandledRejectionGuard({
      target,
      logger: {
        error(): void {
          throw new Error("logging backend is down");
        },
      },
    });

    const event = rejectionEvent(new Error("still contained"));
    target.dispatch("unhandledrejection", event);

    assertEquals(event.prevented, true);
  });

  it("still counts a rejection whose diagnostics failed", () => {
    const target = createFakeTarget();
    const guard = installUnhandledRejectionGuard({
      target,
      logger: {
        error(): void {
          throw new Error("logging backend is down");
        },
      },
    });

    target.dispatch("unhandledrejection", rejectionEvent(new Error("counted")));

    assertEquals(guard.getRejectionCount(), 1);
  });
});
