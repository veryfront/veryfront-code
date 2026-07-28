import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { runProxyShutdownSteps } from "./shutdown.ts";
import {
  acquireProxySignalHandlers,
  createProxyStartupSignalRouter,
  type ProxySignal,
  ProxyStartupSignalError,
} from "./startup-signals.ts";
import { createProxyStartupRollback } from "./startup-rollback.ts";

describe("proxy startup signal ownership", () => {
  it("aborts startup with the first signal before transaction commit", () => {
    const runtimeSignals: ProxySignal[] = [];
    const router = createProxyStartupSignalRouter((signal) => {
      runtimeSignals.push(signal);
    });
    let commitCalls = 0;

    router.handle("SIGTERM");
    const firstReason = router.startupSignal.reason;
    router.handle("SIGINT");

    assertEquals(router.startupSignal.aborted, true);
    assertEquals(firstReason instanceof ProxyStartupSignalError, true);
    assertStrictEquals(router.startupSignal.reason, firstReason);
    assertEquals((firstReason as ProxyStartupSignalError).signal, "SIGTERM");
    assertEquals(
      router.commit(() => {
        commitCalls++;
        return true;
      }),
      false,
    );
    assertEquals(commitCalls, 0);
    assertEquals(runtimeSignals, []);
  });

  it("routes signals to runtime shutdown only after transaction commit", () => {
    const runtimeSignals: ProxySignal[] = [];
    const router = createProxyStartupSignalRouter((signal) => {
      runtimeSignals.push(signal);
    });
    let commitCalls = 0;

    assertEquals(
      router.commit(() => {
        commitCalls++;
        return true;
      }),
      true,
    );
    router.handle("SIGINT");
    router.handle("SIGTERM");

    assertEquals(commitCalls, 1);
    assertEquals(router.startupSignal.aborted, false);
    assertEquals(runtimeSignals, ["SIGINT", "SIGTERM"]);
    assertEquals(router.commit(() => true), false);
  });

  it("keeps startup cancellation armed when transaction commit is refused", () => {
    const runtimeSignals: ProxySignal[] = [];
    const router = createProxyStartupSignalRouter((signal) => {
      runtimeSignals.push(signal);
    });

    assertEquals(router.commit(() => false), false);
    router.handle("SIGINT");

    assertEquals(router.startupSignal.aborted, true);
    assertEquals(
      (router.startupSignal.reason as ProxyStartupSignalError).signal,
      "SIGINT",
    );
    assertEquals(runtimeSignals, []);
  });

  it("owns the batch before registration and rolls back SIGINT when SIGTERM fails", async () => {
    const events: string[] = [];
    const active = new Set<ProxySignal>();
    const registrationError = new Error("SIGTERM is unsupported");
    const rollback = createProxyStartupRollback({ cleanupTimeoutMs: 100 });

    let rejection: unknown;
    try {
      await rollback.run(() =>
        acquireProxySignalHandlers({
          startupRollback: {
            own: (name, cleanup) => {
              events.push(`own:${name}`);
              return rollback.own(name, cleanup);
            },
          },
          registerSignal: (signal) => {
            events.push(`add:${signal}`);
            if (signal === "SIGTERM") throw registrationError;
            active.add(signal);
            return () => {
              events.push(`remove:${signal}`);
              active.delete(signal);
            };
          },
          handleSignal: () => {},
        })
      );
    } catch (error) {
      rejection = error;
    }

    assertStrictEquals(rejection, registrationError);
    assertEquals(events, [
      "own:signal-handlers",
      "add:SIGINT",
      "add:SIGTERM",
      "remove:SIGINT",
    ]);
    assertEquals(active.size, 0);
  });

  it("removes both registrations in reverse order after a later startup failure", async () => {
    const events: string[] = [];
    const startupError = new Error("listener startup failed");
    const rollback = createProxyStartupRollback({ cleanupTimeoutMs: 100 });

    acquireProxySignalHandlers({
      startupRollback: rollback,
      registerSignal: (signal) => {
        events.push(`add:${signal}`);
        return () => events.push(`remove:${signal}`);
      },
      handleSignal: () => {},
    });

    let rejection: unknown;
    try {
      await rollback.run(() => Promise.reject(startupError));
    } catch (error) {
      rejection = error;
    }

    assertStrictEquals(rejection, startupError);
    assertEquals(events, [
      "add:SIGINT",
      "add:SIGTERM",
      "remove:SIGTERM",
      "remove:SIGINT",
    ]);
  });

  it("keeps committed registrations until the final shutdown step", async () => {
    const events: string[] = [];
    const callbacks = new Map<ProxySignal, () => void>();
    const received: ProxySignal[] = [];
    const rollback = createProxyStartupRollback({ cleanupTimeoutMs: 100 });
    const signalHandlers = acquireProxySignalHandlers({
      startupRollback: rollback,
      registerSignal: (signal, handler) => {
        events.push(`add:${signal}`);
        callbacks.set(signal, handler);
        return () => {
          events.push(`remove:${signal}`);
          callbacks.delete(signal);
        };
      },
      handleSignal: (signal) => received.push(signal),
    });

    assertEquals(rollback.commit(), true);
    callbacks.get("SIGINT")?.();
    callbacks.get("SIGTERM")?.();
    assertEquals(received, ["SIGINT", "SIGTERM"]);
    assertEquals(events, ["add:SIGINT", "add:SIGTERM"]);

    const failures = await runProxyShutdownSteps([
      {
        name: "application-errors",
        run: () => events.push("flush"),
      },
      {
        name: "signal-handlers",
        run: signalHandlers.dispose,
      },
    ], 100);
    signalHandlers.dispose();

    assertEquals(failures, []);
    assertEquals(events, [
      "add:SIGINT",
      "add:SIGTERM",
      "flush",
      "remove:SIGTERM",
      "remove:SIGINT",
    ]);
    assertEquals(callbacks.size, 0);
  });

  it("continues disposal and retries only a registration that failed removal", async () => {
    const events: string[] = [];
    const removalError = new Error("SIGTERM removal failed");
    const rollback = createProxyStartupRollback({ cleanupTimeoutMs: 100 });
    let sigtermAttempts = 0;
    const signalHandlers = acquireProxySignalHandlers({
      startupRollback: rollback,
      registerSignal: (signal) => {
        events.push(`add:${signal}`);
        return () => {
          events.push(`remove:${signal}`);
          if (signal === "SIGTERM" && sigtermAttempts++ === 0) {
            throw removalError;
          }
        };
      },
      handleSignal: () => {},
    });
    assertEquals(rollback.commit(), true);

    const failures = await runProxyShutdownSteps([{
      name: "signal-handlers",
      run: signalHandlers.dispose,
    }], 100);
    assertEquals(failures.length, 1);
    assertStrictEquals(
      failures[0]?.status === "failed" ? failures[0].error : undefined,
      removalError,
    );
    assertEquals(events, [
      "add:SIGINT",
      "add:SIGTERM",
      "remove:SIGTERM",
      "remove:SIGINT",
    ]);

    signalHandlers.dispose();
    signalHandlers.dispose();
    assertEquals(events, [
      "add:SIGINT",
      "add:SIGTERM",
      "remove:SIGTERM",
      "remove:SIGINT",
      "remove:SIGTERM",
    ]);
  });
});
