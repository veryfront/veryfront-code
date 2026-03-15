import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
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

  it("rejects submissions for tool calls that are not currently waiting", async () => {
    const sessionManager = new AgentRunSessionManager();
    sessionManager.startRun({ runId: "run_1", threadId: crypto.randomUUID() });

    await assertRejects(
      async () => {
        sessionManager.submitToolResult("run_1", {
          toolCallId: "tool_1",
          result: { ok: true },
        });
      },
      ToolResultNotWaitingError,
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
});
