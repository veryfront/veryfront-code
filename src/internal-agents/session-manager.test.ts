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
