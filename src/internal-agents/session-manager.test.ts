import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  _resetGlobalAgentRunSessionManagerForTesting,
  AgentRunCancelledError,
  AgentRunSessionManager,
  ToolResultConflictError,
  ToolResultNotWaitingError,
} from "./session-manager.ts";

describe("internal-agents/session-manager", () => {
  it("keeps a run's serving span attributes for its own project until the run ends", () => {
    const sessionManager = new AgentRunSessionManager();
    sessionManager.startRun({
      runId: "run_1",
      threadId: crypto.randomUUID(),
      servingIdentity: { projectId: "proj-1", spanAttributes: { "release.id": "rel-1" } },
    });

    assertEquals(sessionManager.getServingSpanAttributes("run_1", "proj-1"), {
      "release.id": "rel-1",
    });
    assertEquals(sessionManager.getServingSpanAttributes("run_1", "proj-2"), undefined);
    assertEquals(sessionManager.getServingSpanAttributes("run_1", undefined), undefined);

    sessionManager.completeRun("run_1");
    assertEquals(sessionManager.getServingSpanAttributes("run_1", "proj-1"), undefined);
  });

  it("accepts duplicate tool results and rejects conflicting ones", async () => {
    const sessionManager = new AgentRunSessionManager();
    sessionManager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });

    const pending = sessionManager.waitForToolResult("run_1", "tool_1");

    const first = sessionManager.submitToolResult("run_1", {
      toolCallId: "tool_1",
      result: { ok: true },
    });
    assertEquals(first, { accepted: true });
    assertEquals(await pending, { result: { ok: true }, isError: false });

    const duplicate = sessionManager.submitToolResult("run_1", {
      toolCallId: "tool_1",
      result: { ok: true },
    });
    assertEquals(duplicate, { accepted: true, duplicate: true });

    await assertRejects(
      async () => {
        sessionManager.submitToolResult("run_1", {
          toolCallId: "tool_1",
          result: { ok: false },
        });
      },
      ToolResultConflictError,
    );
  });

  it("treats key-reordered tool results as the same result", async () => {
    const sessionManager = new AgentRunSessionManager();
    sessionManager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });

    const pending = sessionManager.waitForToolResult("run_1", "tool_1");

    assertEquals(
      sessionManager.submitToolResult("run_1", {
        toolCallId: "tool_1",
        result: { a: 1, b: 2, nested: { x: 1, y: 2 } },
      }),
      { accepted: true },
    );
    await pending;

    assertEquals(
      sessionManager.submitToolResult("run_1", {
        toolCallId: "tool_1",
        result: { nested: { y: 2, x: 1 }, b: 2, a: 1 },
      }),
      { accepted: true, duplicate: true },
      "a retry with reordered JSON keys is the same result, not a conflict",
    );

    await assertRejects(
      async () => {
        sessionManager.submitToolResult("run_1", {
          toolCallId: "tool_1",
          result: { a: 1, b: 3, nested: { x: 1, y: 2 } },
        });
      },
      ToolResultConflictError,
    );
    sessionManager.completeRun("run_1");
  });

  it("hands a client-reported tool failure to the agent as an error", async () => {
    const sessionManager = new AgentRunSessionManager();
    sessionManager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });

    const pending = sessionManager.waitForToolResult("run_1", "tool_1");

    assertEquals(
      sessionManager.submitToolResult("run_1", {
        toolCallId: "tool_1",
        result: { message: "permission denied" },
        isError: true,
      }),
      { accepted: true },
    );
    assertEquals(
      await pending,
      { result: { message: "permission denied" }, isError: true },
      "a failed client tool call must reach the agent flagged as an error",
    );

    await assertRejects(
      async () => {
        sessionManager.submitToolResult("run_1", {
          toolCallId: "tool_1",
          result: { message: "permission denied" },
        });
      },
      ToolResultConflictError,
    );
    sessionManager.completeRun("run_1");
  });

  it("buffers submissions that arrive before the tool call starts waiting", async () => {
    const sessionManager = new AgentRunSessionManager();
    sessionManager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });
    sessionManager.prepareForToolResult("run_1", "tool_1");

    assertEquals(
      sessionManager.submitToolResult("run_1", {
        toolCallId: "tool_1",
        result: { ok: true },
      }),
      { accepted: true },
    );

    assertEquals(await sessionManager.waitForToolResult("run_1", "tool_1"), {
      result: { ok: true },
      isError: false,
    });
    sessionManager.completeRun("run_1");
  });

  it("still rejects tool results for a different wait key while another wait is pending", async () => {
    const sessionManager = new AgentRunSessionManager();
    sessionManager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });

    const pending = sessionManager.waitForToolResult("run_1", "tool_1");

    await assertRejects(
      async () => {
        sessionManager.submitToolResult("run_1", {
          toolCallId: "tool_2",
          result: { ok: true },
        });
      },
      ToolResultNotWaitingError,
    );

    assertEquals(sessionManager.cancelRun("run_1"), true);
    await assertRejects(
      async () => {
        await pending;
      },
      AgentRunCancelledError,
    );
  });

  it("cancels waiting runs and rejects the parked tool promise", async () => {
    const sessionManager = new AgentRunSessionManager();
    sessionManager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });

    const pending = sessionManager.waitForToolResult("run_1", "tool_1");
    assertEquals(sessionManager.cancelRun("run_1"), true);

    await assertRejects(
      async () => {
        await pending;
      },
      AgentRunCancelledError,
    );
    assertEquals(sessionManager.getRunStatus("run_1"), null);
  });

  it("expires waiting runs after the configured TTL", async () => {
    const timerCallbacks: Array<() => void> = [];
    const sessionManager = new AgentRunSessionManager({
      waitingForToolTtlMs: 1,
      setTimeoutFn: ((callback: () => void) => {
        timerCallbacks.push(callback);
        return timerCallbacks.length as unknown as number;
      }) as typeof setTimeout,
      clearTimeoutFn: (() => {}) as typeof clearTimeout,
    });
    sessionManager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });

    const pending = sessionManager.waitForToolResult("run_1", "tool_1");
    assertEquals(sessionManager.getRunStatus("run_1"), "waiting");

    timerCallbacks[0]?.();

    await assertRejects(
      async () => {
        await pending;
      },
      AgentRunCancelledError,
    );
    assertEquals(sessionManager.getRunStatus("run_1"), null);
  });

  it("evicts stale running sessions after the configured session TTL", () => {
    const timerCallbacks: Array<() => void> = [];
    const sessionManager = new AgentRunSessionManager({
      sessionTtlMs: 1,
      setTimeoutFn: ((callback: () => void) => {
        timerCallbacks.push(callback);
        return timerCallbacks.length as unknown as number;
      }) as typeof setTimeout,
      clearTimeoutFn: (() => {}) as typeof clearTimeout,
    });

    sessionManager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });
    assertEquals(sessionManager.getRunStatus("run_1"), "running");

    timerCallbacks[0]?.();

    assertEquals(sessionManager.getRunStatus("run_1"), null);
  });

  it("does not carry a timed-out run's serving identity into a restart without one", () => {
    const timerCallbacks: Array<() => void> = [];
    const sessionManager = new AgentRunSessionManager({
      sessionTtlMs: 1,
      setTimeoutFn: ((callback: () => void) => {
        timerCallbacks.push(callback);
        return timerCallbacks.length as unknown as number;
      }) as typeof setTimeout,
      clearTimeoutFn: (() => {}) as typeof clearTimeout,
    });
    sessionManager.startRun({
      runId: "run_1",
      threadId: crypto.randomUUID(),
      servingIdentity: { projectId: "proj-1", spanAttributes: { "release.id": "rel-1" } },
    });

    timerCallbacks[0]?.();
    sessionManager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });

    assertEquals(sessionManager.getServingSpanAttributes("run_1", "proj-1"), undefined);
  });

  it("releases serving identities when session or waiting TTLs cancel runs", () => {
    const timerCallbacks: Array<() => void> = [];
    const sessionManager = new AgentRunSessionManager({
      sessionTtlMs: 1,
      waitingForToolTtlMs: 1,
      setTimeoutFn: ((callback: () => void) => {
        timerCallbacks.push(callback);
        return timerCallbacks.length as unknown as number;
      }) as typeof setTimeout,
      clearTimeoutFn: (() => {}) as typeof clearTimeout,
    });
    const retainedIdentities = () =>
      (sessionManager as unknown as { servingIdentities: Map<string, unknown> })
        .servingIdentities.size;
    const servingIdentity = { projectId: "proj-1", spanAttributes: { "release.id": "rel-1" } };

    sessionManager.startRun({ runId: "run_1", threadId: crypto.randomUUID(), servingIdentity });
    timerCallbacks.at(-1)?.();
    assertEquals(sessionManager.getRunStatus("run_1"), null);
    assertEquals(retainedIdentities(), 0);

    sessionManager.startRun({ runId: "run_2", threadId: crypto.randomUUID(), servingIdentity });
    sessionManager.waitForToolResult("run_2", "tool_1").catch(() => {});
    timerCallbacks.at(-1)?.();
    assertEquals(sessionManager.getRunStatus("run_2"), null);
    assertEquals(retainedIdentities(), 0);
  });

  it("reuses the global session manager across duplicate module evaluations", async () => {
    _resetGlobalAgentRunSessionManagerForTesting();

    try {
      const firstModule = await import(
        new URL(`./session-manager.ts?instance=${crypto.randomUUID()}`, import.meta.url).href
      ) as typeof import("./session-manager.ts");
      const duplicateModule = await import(
        new URL(`./session-manager.ts?instance=${crypto.randomUUID()}`, import.meta.url).href
      ) as typeof import("./session-manager.ts");

      assertEquals(
        duplicateModule.agentRunSessionManager === firstModule.agentRunSessionManager,
        true,
      );

      firstModule.agentRunSessionManager.startRun({
        runId: "run_global",
        threadId: crypto.randomUUID(),
      });
      assertEquals(duplicateModule.agentRunSessionManager.getRunStatus("run_global"), "running");
      assertEquals(duplicateModule.agentRunSessionManager.cancelRun("run_global"), true);
      assertEquals(firstModule.agentRunSessionManager.getRunStatus("run_global"), null);
    } finally {
      _resetGlobalAgentRunSessionManagerForTesting();
    }
  });

  it("rejects runs that exceed the configured concurrency limit", () => {
    const sessionManager = new AgentRunSessionManager({ maxConcurrentSessions: 1 });
    sessionManager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });

    assertThrows(
      () => sessionManager.startRun({ runId: "run_2", threadId: crypto.randomUUID() }),
      Error,
      "Maximum concurrent sessions (1) reached",
    );
  });
});

describe("cancelled execution finalization", () => {
  it("retires bounded cancellation tracking after the original producer settles", () => {
    const manager = new AgentRunSessionManager();
    try {
      for (let index = 0; index < 1_101; index++) {
        const runId = `cancelled-${index}`;
        const signal = manager.startRun({ runId, threadId: "thread" });
        manager.cancelRun(runId);
        manager.settleCancelledRun(runId, signal);
        assertEquals(manager.getRunStatus(runId), null);
      }
      const signal = manager.startRun({ runId: "after-cancellations", threadId: "thread" });
      manager.completeRun("after-cancellations", signal);
    } finally {
      manager.reset();
    }
  });
});

describe("cancelled producer capacity", () => {
  for (const finalize of ["completeRun", "failRun"] as const) {
    it(`retains ordinary capacity until ${finalize} joins cleanup`, () => {
      const manager = new AgentRunSessionManager({ maxConcurrentSessions: 1 });
      try {
        const signal = manager.startRun({ runId: "ordinary", threadId: "thread" });
        manager.cancelRun("ordinary");
        assertEquals(signal.aborted, true);
        assertThrows(
          () => manager.startRun({ runId: "next", threadId: "thread" }),
          Error,
          "Maximum concurrent sessions",
        );
        manager[finalize]("ordinary", signal);
        const next = manager.startRun({ runId: "next", threadId: "thread" });
        manager.completeRun("next", next);
      } finally {
        manager.reset();
      }
    });
  }
});

it("same-id replacement retains both producers until their matching finalizers", () => {
  const manager = new AgentRunSessionManager({ maxConcurrentSessions: 2 });
  try {
    const old = manager.startRun({ runId: "reused", threadId: "thread" });
    manager.cancelRun("reused");
    const replacement = manager.startRun({ runId: "reused", threadId: "thread" });
    assertThrows(() => manager.startRun({ runId: "third", threadId: "thread" }));
    manager.failRun("reused", old);
    assertEquals(manager.getRunStatus("reused"), "running");
    const third = manager.startRun({ runId: "third", threadId: "thread" });
    manager.completeRun("reused", replacement);
    manager.completeRun("third", third);
  } finally {
    manager.reset();
  }
});

it("session TTL cancellation retains producer capacity until cleanup", async () => {
  const manager = new AgentRunSessionManager({ maxConcurrentSessions: 1, sessionTtlMs: 1 });
  try {
    const signal = manager.startRun({ runId: "expired", threadId: "thread" });
    await new Promise<void>((resolve) =>
      signal.addEventListener("abort", () => resolve(), { once: true })
    );
    assertThrows(() => manager.startRun({ runId: "next", threadId: "thread" }));
    manager.completeRun("expired", signal);
    const next = manager.startRun({ runId: "next", threadId: "thread" });
    manager.completeRun("next", next);
  } finally {
    manager.reset();
  }
});

it("cancelled settlement cannot release a live or replacement producer", () => {
  const manager = new AgentRunSessionManager({ maxConcurrentSessions: 2 });
  try {
    const old = manager.startRun({ runId: "reused", threadId: "thread" });
    manager.settleCancelledRun("reused", old);
    const peer = manager.startRun({ runId: "peer", threadId: "thread" });
    assertThrows(() => manager.startRun({ runId: "blocked", threadId: "thread" }));
    manager.completeRun("peer", peer);
    manager.cancelRun("reused", old);
    const replacement = manager.startRun({ runId: "reused", threadId: "thread" });
    manager.settleCancelledRun("wrong-id", old);
    assertThrows(() => manager.startRun({ runId: "blocked", threadId: "thread" }));
    manager.settleCancelledRun("reused", old);
    manager.settleCancelledRun("reused", old);
    assertEquals(manager.getRunStatus("reused"), "running");
    const next = manager.startRun({ runId: "next", threadId: "thread" });
    assertThrows(() => manager.startRun({ runId: "blocked", threadId: "thread" }));
    manager.completeRun("reused", replacement);
    manager.completeRun("next", next);
  } finally {
    manager.reset();
  }
});

it("settles overflow cancelled sessions and ordinary capacity under the same signal", () => {
  const manager = new AgentRunSessionManager({ maxConcurrentSessions: 1001 });
  const signals: AbortSignal[] = [];
  try {
    for (let index = 0; index <= 1000; index++) {
      const id = `overflow-${index}`;
      signals.push(manager.startRun({ runId: id, threadId: "thread" }));
      manager.cancelRun(id);
    }
    const overflow = signals[1000];
    if (!overflow) throw new Error("Expected overflow producer");
    assertEquals(manager.getRunStatus("overflow-1000"), "cancelled");
    assertThrows(() => manager.startRun({ runId: "blocked", threadId: "thread" }));
    manager.settleCancelledRun("overflow-1000", overflow);
    assertEquals(manager.getRunStatus("overflow-1000"), null);
    const replacement = manager.startRun({ runId: "overflow-1000", threadId: "thread" });
    manager.settleCancelledRun("overflow-1000", overflow);
    assertEquals(manager.getRunStatus("overflow-1000"), "running");
    assertThrows(() => manager.startRun({ runId: "blocked", threadId: "thread" }));
    manager.cancelRun("overflow-1000", replacement);
    manager.settleCancelledRun("overflow-1000", replacement);
    for (let index = 0; index < 1000; index++) {
      const signal = signals[index];
      if (!signal) throw new Error("Expected cancelled producer");
      manager.settleCancelledRun(`overflow-${index}`, signal);
    }
    const next = manager.startRun({ runId: "after-overflow", threadId: "thread" });
    manager.completeRun("after-overflow", next);
  } finally {
    manager.reset();
  }
});
