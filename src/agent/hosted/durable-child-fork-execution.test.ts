import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildChildRunExecutionSnapshot,
  type ChildRunExecutionResult,
} from "../child-run/execution-snapshot.ts";
import type { ConversationRunTargets } from "../durable.ts";
import {
  buildHostedDurableChildInvokeFailureResult,
  buildHostedDurableChildInvokeSuccessResult,
  buildHostedDurableChildInvokeTerminalFailureResult,
  createHostedDurableChildInvokeTraceRecorder,
  executeHostedDurableChildFork,
  executeHostedLocalChildInvoke,
  type HostedDurableChildSetupFailure,
  type HostedDurableChildSuccess,
} from "./durable-child-fork-execution.ts";
import type { InvokeAgentChildRunProgressEvent } from "../invoke-agent-child-runs.ts";

const API_URL = "https://api.example.com";
const AUTH_TOKEN = "token-123";
const PARENT_CONVERSATION_ID = "11111111-1111-4111-a111-111111111111";
const CHILD_CONVERSATION_ID = "22222222-2222-4222-a222-222222222222";
const PARENT_MESSAGE_ID = "33333333-3333-4333-a333-333333333333";
const CHILD_MESSAGE_ID = "44444444-4444-4444-8444-444444444444";
const PROJECT_ID = "55555555-5555-4555-8555-555555555555";
const BRANCH_ID = "66666666-6666-4666-8666-666666666666";
const originalFetch = globalThis.fetch;

type DurableChildResult =
  | { status: "missing_context"; message: string }
  | { status: "setup_failed"; failure: HostedDurableChildSetupFailure }
  | { status: "completed"; success: HostedDurableChildSuccess<ChildRunExecutionResult> };

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function acceptedRunResponse(run: unknown): Response {
  return jsonResponse({ accepted: true, run }, 202);
}

function stubFetchWithRecorder(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> | Response,
): { requests: { url: string; body: unknown }[] } {
  const requests: { url: string; body: unknown }[] = [];
  globalThis.fetch = async (input, init) => {
    requests.push({
      url: String(input),
      body: getRequestBody(init),
    });
    return handler(input, init);
  };
  return { requests };
}

function getRequestBody(init: RequestInit | undefined): unknown {
  if (!init || !("body" in init) || !init.body) {
    return null;
  }

  return JSON.parse(String(init.body));
}

function getRecordedRequest(
  requests: { url: string; body: unknown }[],
  index: number,
): { url: string; body: unknown } {
  const request = requests[index];
  if (!request) {
    throw new Error(`Missing request at index ${index}`);
  }
  return request;
}

function getPublicId(value: unknown): string {
  if (
    !value || typeof value !== "object" || !("public_id" in value) ||
    typeof value.public_id !== "string"
  ) {
    throw new Error("Missing string property public_id");
  }

  return value.public_id;
}

function baseSuccessResult(): ChildRunExecutionResult {
  return {
    success: true,
    description: "Inspect logs",
    summary: { text: "Found logs" },
    steps: 2,
    toolCalls: [],
    toolResults: [],
    usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7 },
    durationMs: 12,
  };
}

describe("agent/hosted-durable-child-fork-execution", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("builds standard hosted invoke failure, terminal failure, and success results", () => {
    const identifiers = {
      childConversationId: CHILD_CONVERSATION_ID,
      childRunId: "run_child_1",
      childMessageId: CHILD_MESSAGE_ID,
      latestEventId: 7,
      latestExternalEventSequence: 3,
    };
    const targets = {
      sourceTargetKind: "preview_branch",
      runtimeTargetKind: "preview_branch",
      targetBranchId: BRANCH_ID,
    } satisfies ConversationRunTargets;

    assertEquals(
      buildHostedDurableChildInvokeFailureResult({
        terminalErrorCode: "SETUP_FAILED",
        terminalErrorMessage: "setup failed",
        targets,
        childConversationId: CHILD_CONVERSATION_ID,
      }),
      {
        ok: false,
        status: "failed",
        childConversationId: CHILD_CONVERSATION_ID,
        sourceTargetKind: "preview_branch",
        runtimeTargetKind: "preview_branch",
        terminalErrorCode: "SETUP_FAILED",
        terminalErrorMessage: "setup failed",
      },
    );

    assertEquals(
      buildHostedDurableChildInvokeTerminalFailureResult({
        status: "failed",
        identifiers,
        targets,
        terminalErrorCode: "INVOKE_AGENT_FAILED",
        terminalErrorMessage: "child failed",
      }),
      {
        ok: false,
        status: "failed",
        childConversationId: CHILD_CONVERSATION_ID,
        childRunId: "run_child_1",
        childMessageId: CHILD_MESSAGE_ID,
        sourceTargetKind: "preview_branch",
        runtimeTargetKind: "preview_branch",
        terminalErrorCode: "INVOKE_AGENT_FAILED",
        terminalErrorMessage: "child failed",
      },
    );

    assertEquals(
      buildHostedDurableChildInvokeSuccessResult({
        result: baseSuccessResult(),
        snapshot: buildChildRunExecutionSnapshot(baseSuccessResult()),
        identifiers,
        targets,
      }),
      {
        ok: true,
        status: "completed",
        text: "Found logs",
        summary: { text: "Found logs" },
        steps: 2,
        toolCalls: [],
        toolResults: [],
        usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7 },
        durationMs: 12,
        childConversationId: CHILD_CONVERSATION_ID,
        childRunId: "run_child_1",
        childMessageId: CHILD_MESSAGE_ID,
        sourceTargetKind: "preview_branch",
        runtimeTargetKind: "preview_branch",
        terminalErrorCode: null,
        terminalErrorMessage: null,
      },
    );
  });

  it("records standard hosted invoke trace attributes while building results", () => {
    const recordedAttributes: unknown[] = [];
    const identifiers = {
      childConversationId: CHILD_CONVERSATION_ID,
      childRunId: "run_child_1",
      childMessageId: CHILD_MESSAGE_ID,
      latestEventId: 7,
      latestExternalEventSequence: 3,
    };
    const targets = {
      sourceTargetKind: "preview_branch",
      runtimeTargetKind: "preview_branch",
      targetBranchId: BRANCH_ID,
    } satisfies ConversationRunTargets;
    const recorder = createHostedDurableChildInvokeTraceRecorder({
      traceBase: {
        conversationId: PARENT_CONVERSATION_ID,
        projectId: PROJECT_ID,
        runId: "run_parent_1",
        toolCallId: "tool-call-1",
        childAgentId: "invoke-agent-child",
      },
      executionFailedCode: "INVOKE_AGENT_FAILED",
      setTraceAttributes: (attributes) => {
        recordedAttributes.push(attributes);
      },
    });

    recorder.annotate();
    assertEquals(recordedAttributes.at(-1), {
      "conversation.id": PARENT_CONVERSATION_ID,
      "project.id": PROJECT_ID,
      "run.id": "run_parent_1",
      "child.agent.id": "invoke-agent-child",
      "tool.name": "invoke_agent",
      "tool.call.id": "tool-call-1",
      "gen_ai.operation.name": "execute_tool",
      "gen_ai.tool.name": "invoke_agent",
      "gen_ai.tool.type": "function",
      "gen_ai.tool.call.id": "tool-call-1",
    });

    const localFailure: ChildRunExecutionResult = {
      success: false,
      description: "Inspect logs",
      error: "local failed",
      steps: 2,
      toolCalls: [],
      toolResults: [],
      usage: { inputTokens: 3, outputTokens: 4, totalTokens: 7 },
      durationMs: 12,
    };
    assertEquals(recorder.recordLocalResult(localFailure), localFailure);
    assertEquals(recordedAttributes.at(-1), {
      "conversation.id": PARENT_CONVERSATION_ID,
      "project.id": PROJECT_ID,
      "run.id": "run_parent_1",
      "child.agent.id": "invoke-agent-child",
      "agent.run.final_status": "failed",
      "tool.name": "invoke_agent",
      "tool.call.id": "tool-call-1",
      "gen_ai.operation.name": "execute_tool",
      "gen_ai.tool.name": "invoke_agent",
      "gen_ai.tool.type": "function",
      "gen_ai.tool.call.id": "tool-call-1",
      "error.type": "INVOKE_AGENT_FAILED",
      "error.message": "local failed",
      "gen_ai.usage.input_tokens": 3,
      "gen_ai.usage.output_tokens": 4,
    });

    assertEquals(
      recorder.recordSetupFailure({
        targets,
        childConversationId: CHILD_CONVERSATION_ID,
        childRunId: "run_child_1",
        childMessageId: CHILD_MESSAGE_ID,
        terminalErrorCode: "SETUP_FAILED",
        terminalErrorMessage: "setup failed",
      }),
      {
        ok: false,
        status: "failed",
        childConversationId: CHILD_CONVERSATION_ID,
        childRunId: "run_child_1",
        childMessageId: CHILD_MESSAGE_ID,
        sourceTargetKind: "preview_branch",
        runtimeTargetKind: "preview_branch",
        terminalErrorCode: "SETUP_FAILED",
        terminalErrorMessage: "setup failed",
      },
    );
    assertEquals(recordedAttributes.at(-1), {
      "conversation.id": PARENT_CONVERSATION_ID,
      "project.id": PROJECT_ID,
      "run.id": "run_parent_1",
      "child.agent.id": "invoke-agent-child",
      "child.conversation.id": CHILD_CONVERSATION_ID,
      "child.run.id": "run_child_1",
      "child.message.id": CHILD_MESSAGE_ID,
      "source.target.kind": "preview_branch",
      "runtime.target.kind": "preview_branch",
      "agent.run.final_status": "failed",
      "tool.name": "invoke_agent",
      "tool.call.id": "tool-call-1",
      "gen_ai.operation.name": "execute_tool",
      "gen_ai.tool.name": "invoke_agent",
      "gen_ai.tool.type": "function",
      "gen_ai.tool.call.id": "tool-call-1",
      "error.type": "SETUP_FAILED",
      "error.message": "setup failed",
    });

    assertEquals(
      recorder.recordSuccess({
        result: baseSuccessResult(),
        snapshot: buildChildRunExecutionSnapshot(baseSuccessResult()),
        identifiers,
        targets,
      }),
      buildHostedDurableChildInvokeSuccessResult({
        result: baseSuccessResult(),
        snapshot: buildChildRunExecutionSnapshot(baseSuccessResult()),
        identifiers,
        targets,
      }),
    );
    assertEquals(recordedAttributes.at(-1), {
      "conversation.id": PARENT_CONVERSATION_ID,
      "project.id": PROJECT_ID,
      "run.id": "run_parent_1",
      "child.agent.id": "invoke-agent-child",
      "child.conversation.id": CHILD_CONVERSATION_ID,
      "child.run.id": "run_child_1",
      "child.message.id": CHILD_MESSAGE_ID,
      "source.target.kind": "preview_branch",
      "runtime.target.kind": "preview_branch",
      "agent.run.final_status": "completed",
      "tool.name": "invoke_agent",
      "tool.call.id": "tool-call-1",
      "gen_ai.operation.name": "execute_tool",
      "gen_ai.tool.name": "invoke_agent",
      "gen_ai.tool.type": "function",
      "gen_ai.tool.call.id": "tool-call-1",
      "gen_ai.usage.input_tokens": 3,
      "gen_ai.usage.output_tokens": 4,
    });
  });

  it("records successful local child invoke results", async () => {
    const localResult: ChildRunExecutionResult = {
      success: true,
      description: "Inspect logs",
      summary: { text: "done" },
      steps: 1,
      toolCalls: [],
      toolResults: [],
      durationMs: 10,
    };
    const recordedFailures: string[] = [];
    const result = await executeHostedLocalChildInvoke({
      forkInput: { description: "Inspect logs" },
      traceRecorder: {
        recordLocalResult: (recordedResult) => recordedResult,
        recordLocalFailure: (errorMessage) => {
          recordedFailures.push(errorMessage);
        },
      },
      execute: () => localResult,
    });

    assertEquals(result, localResult);
    assertEquals(recordedFailures, []);
  });

  it("normalizes non-abort local child invoke failures", async () => {
    const recordedFailures: string[] = [];
    const result = await executeHostedLocalChildInvoke({
      forkInput: { description: "Inspect logs" },
      traceRecorder: {
        recordLocalResult: (recordedResult) => recordedResult,
        recordLocalFailure: (errorMessage) => {
          recordedFailures.push(errorMessage);
        },
      },
      execute: () => {
        throw new Error("provider failed");
      },
    });

    assertEquals(recordedFailures, ["provider failed"]);
    assertEquals(result, {
      success: false,
      description: "Inspect logs",
      error: "provider failed",
      steps: 0,
      toolCalls: [],
      toolResults: [],
      durationMs: 0,
    });
  });

  it("rethrows user-requested local child invoke aborts", async () => {
    const abortController = new AbortController();
    abortController.abort();
    const abortError = new Error("Aborted");

    await assertRejects(
      () =>
        executeHostedLocalChildInvoke({
          forkInput: { description: "Inspect logs" },
          abortSignal: abortController.signal,
          traceRecorder: {
            recordLocalResult: (recordedResult) => recordedResult,
            recordLocalFailure: () => {},
          },
          execute: () => {
            throw abortError;
          },
          isAbortError: (error) => error === abortError,
        }),
      Error,
      "Aborted",
    );
  });

  it("returns a host-shaped context-unavailable result without bootstrapping", async () => {
    const result = await executeHostedDurableChildFork<DurableChildResult, ChildRunExecutionResult>(
      {
        authToken: AUTH_TOKEN,
        apiUrl: API_URL,
        forkInput: { description: "Inspect logs", prompt: "Find logs" },
        executionOptions: { toolCallId: "tool-call-1" },
        childAgentId: "invoke-agent-child",
        getProjectId: () => PROJECT_ID,
        defaultModel: "opus",
        resolveModelId: (model) => `resolved-${model}`,
        resolveProvider: () => "anthropic",
        contextUnavailableMessage: "missing context",
        setupFailedCode: "SETUP_FAILED",
        executionFailedCode: "INVOKE_AGENT_FAILED",
        executeLocal: () => baseSuccessResult(),
        getExecutionSnapshot: () => null,
        buildContextUnavailableResult: (message) => ({ status: "missing_context", message }),
        buildSetupFailureResult: (failure) => ({ status: "setup_failed", failure }),
        buildTerminalFailureResult: () => ({ status: "missing_context", message: "unexpected" }),
        buildSuccessResult: (success) => ({ status: "completed", success }),
      },
    );

    assertEquals(result, { status: "missing_context", message: "missing context" });
  });

  it("bootstraps, runs lifecycle progress, and returns host-shaped success", async () => {
    let projectId = PROJECT_ID;
    const lifecycleStatuses: string[] = [];
    const bootstrapCalls: string[] = [];
    const { requests } = stubFetchWithRecorder((_input, _init) => {
      const requestCount = requests.length;
      if (requestCount === 1) {
        return jsonResponse({ id: PARENT_CONVERSATION_ID, project_id: projectId }, 200);
      }
      if (requestCount === 2) {
        return jsonResponse({ id: CHILD_CONVERSATION_ID, project_id: projectId }, 200);
      }
      if (requestCount === 3) {
        return jsonResponse({ id: CHILD_MESSAGE_ID }, 200);
      }
      if (requestCount === 4) {
        return acceptedRunResponse({ run_id: "run_child_1" });
      }
      if (requestCount === 5) {
        return jsonResponse(
          {
            run_id: "run_child_1",
            conversation_id: CHILD_CONVERSATION_ID,
            message_id: CHILD_MESSAGE_ID,
            latest_event_id: 7,
            latest_external_event_sequence: 3,
            status: "running",
          },
          200,
        );
      }
      if (requestCount === 6) {
        return jsonResponse(
          {
            completed: true,
            run: { run_id: "run_child_1", status: "completed" },
          },
          200,
        );
      }

      throw new Error("Unexpected fetch call");
    });

    const result = await executeHostedDurableChildFork<DurableChildResult, ChildRunExecutionResult>(
      {
        authToken: AUTH_TOKEN,
        apiUrl: API_URL,
        forkInput: {
          description: "Inspect logs",
          prompt: "Find logs",
          project_id: "77777777-7777-4777-8777-777777777777",
        },
        executionOptions: { toolCallId: "tool-call-1" },
        childAgentId: "invoke-agent-child",
        runProjectId: projectId,
        parentConversationId: PARENT_CONVERSATION_ID,
        parentRunId: "run_parent_1",
        parentMessageId: PARENT_MESSAGE_ID,
        getProjectId: () => projectId,
        getBranchId: () => BRANCH_ID,
        getContextModel: () => "sonnet",
        defaultModel: "opus",
        resolveModelId: (model) => `resolved-${model}`,
        resolveProvider: (model) => `provider-${model}`,
        onRequestedProjectId: (requestedProjectId) => {
          projectId = requestedProjectId;
        },
        publishParentRunEvents: (events: InvokeAgentChildRunProgressEvent[]) => {
          for (const event of events) {
            if (event.type === "CUSTOM") {
              lifecycleStatuses.push(event.value.status);
            }
          }
        },
        contextUnavailableMessage: "missing context",
        setupFailedCode: "SETUP_FAILED",
        executionFailedCode: "INVOKE_AGENT_FAILED",
        executeLocal: () => baseSuccessResult(),
        getExecutionSnapshot: () => null,
        buildContextUnavailableResult: (message) => ({ status: "missing_context", message }),
        buildSetupFailureResult: (failure) => ({ status: "setup_failed", failure }),
        buildTerminalFailureResult: () => ({ status: "missing_context", message: "unexpected" }),
        buildSuccessResult: (success) => ({ status: "completed", success }),
        bootstrap: {
          runBootstrap: async (operation) => {
            bootstrapCalls.push("wrapped");
            return operation();
          },
          onBootstrapStart: (bootstrapContext) => {
            bootstrapCalls.push(`start:${bootstrapContext.resolvedModel}`);
          },
          onBootstrapComplete: (bootstrapContext) => {
            bootstrapCalls.push(`complete:${bootstrapContext.identifiers.childRunId}`);
          },
        },
      },
    );

    if (result.status !== "completed") {
      throw new Error("Expected completed result");
    }

    assertEquals(projectId, "77777777-7777-4777-8777-777777777777");
    assertEquals(bootstrapCalls, ["wrapped", "start:resolved-sonnet", "complete:run_child_1"]);
    assertEquals(lifecycleStatuses, ["pending", "running", "completed"]);
    assertEquals(result.success.identifiers, {
      childConversationId: CHILD_CONVERSATION_ID,
      childRunId: "run_child_1",
      childMessageId: CHILD_MESSAGE_ID,
      latestEventId: 7,
      latestExternalEventSequence: 3,
    });
    assertEquals(result.success.targets, {
      sourceTargetKind: "preview_branch",
      runtimeTargetKind: "preview_branch",
      targetBranchId: BRANCH_ID,
    });
    assertEquals(result.success.snapshot.success, true);
    const createRunBody = getRecordedRequest(requests, 3).body;
    assertEquals(createRunBody, {
      kind: "agent",
      owner: {
        kind: "conversation",
        id: CHILD_CONVERSATION_ID,
      },
      public_id: getPublicId(createRunBody),
      request: {
        mode: "default_chat",
        agent_id: "invoke-agent-child",
        initial_status: "running",
        source_target_kind: "preview_branch",
        runtime_target_kind: "preview_branch",
        source_target_branch_id: BRANCH_ID,
        runtime_target_branch_id: BRANCH_ID,
      },
    });
    assertEquals(getRecordedRequest(requests, 5).body, {
      status: "completed",
      metadata: {
        provider: "provider-resolved-sonnet",
        model: "resolved-sonnet",
        inputTokens: 3,
        outputTokens: 4,
        finishReason: "stop",
      },
      terminal_error_code: null,
      terminal_error_message: null,
    });
  });
});
