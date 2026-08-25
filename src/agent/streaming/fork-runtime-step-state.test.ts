import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import type { Message as AgentMessage } from "../schemas/index.ts";
import {
  applyPartToStreamedStepState,
  createStreamedStepState,
  resolveForkStepResponse,
} from "./fork-runtime-step-state.ts";

describe("agent/fork-runtime-step-state", () => {
  it("builds a fallback agent response from streamed text and tool parts", async () => {
    const currentMessages: AgentMessage[] = [{
      id: "user-1",
      role: "user",
      timestamp: 1,
      parts: [{ type: "text", text: "Create the plan." }],
    }];
    const state = createStreamedStepState();

    applyPartToStreamedStepState(state, { type: "text-delta", text: "Created." });
    applyPartToStreamedStepState(state, {
      type: "tool-call",
      toolCallId: "tool-1",
      toolName: "create_file",
      input: { path: "plan.md" },
    });
    applyPartToStreamedStepState(state, {
      type: "tool-result",
      toolCallId: "tool-1",
      toolName: "create_file",
      input: { path: "plan.md" },
      output: { path: "plan.md", ok: true },
    });

    const response = await resolveForkStepResponse({
      responsePromise: new Promise<never>(() => {}),
      responseTimeoutMs: 1,
      currentMessages,
      streamedStepState: state,
    });

    assertEquals(response.text, "Created.");
    assertEquals(response.status, "completed");
    assertEquals(response.toolCalls, [{
      id: "tool-1",
      name: "create_file",
      args: { path: "plan.md" },
      status: "completed",
      result: { path: "plan.md", ok: true },
    }]);
    assertEquals(response.messages.map((message) => message.role), [
      "user",
      "assistant",
      "tool",
    ]);
  });

  it("rejects with the signal reason when the fork step is already aborted", async () => {
    const reason = new Error("fork aborted by host");
    const controller = new AbortController();
    controller.abort(reason);

    await assertRejects(
      () =>
        resolveForkStepResponse({
          responsePromise: new Promise<never>(() => {}),
          responseTimeoutMs: 1,
          abortSignal: controller.signal,
          currentMessages: [],
          streamedStepState: createStreamedStepState(),
        }),
      Error,
      "fork aborted by host",
      "an already-aborted signal must reject with the signal reason",
    );
  });

  it("fails loudly when there is no streamed content and no recoverable prior work", async () => {
    await assertRejects(
      () =>
        resolveForkStepResponse({
          responsePromise: new Promise<never>(() => {}),
          responseTimeoutMs: 1,
          currentMessages: [{
            id: "user-1",
            role: "user",
            timestamp: 1,
            parts: [{ type: "text", text: "Create the plan." }],
          }],
          streamedStepState: createStreamedStepState(),
        }),
      Error,
      "without recoverable output",
      "a fork with no streamed content and no prior artifacts must fail loudly",
    );
  });

  it("maps tool-error parts to an errored tool call", async () => {
    const state = createStreamedStepState();

    applyPartToStreamedStepState(state, {
      type: "tool-call",
      toolCallId: "tool-1",
      toolName: "create_file",
      input: { path: "a.md" },
    });
    applyPartToStreamedStepState(state, {
      type: "tool-error",
      toolCallId: "tool-1",
      toolName: "create_file",
      input: { path: "a.md" },
      error: new Error("disk full"),
    });

    const response = await resolveForkStepResponse({
      responsePromise: new Promise<never>(() => {}),
      responseTimeoutMs: 1,
      currentMessages: [],
      streamedStepState: state,
    });

    assertEquals(
      response.toolCalls[0],
      {
        id: "tool-1",
        name: "create_file",
        args: { path: "a.md" },
        status: "error",
        error: "disk full",
      },
      "tool-error parts must map to status error carrying the error text",
    );
  });
});
