import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildChildRunExecutionSnapshot,
  type ChildRunExecutionResult,
} from "../child-run/execution-snapshot.ts";
import { buildChildRunResultSummary } from "../child-run/result-summary.ts";
import type { ConversationRunTargets } from "../conversation/durable.ts";
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
import type { InvokeAgentChildRunProgressEvent } from "../child-run/invoke-agent-child-runs.ts";

const API_URL = "https://api.example.com";
const AUTH_TOKEN = "token-123";
const PARENT_CONVERSATION_ID = "11111111-1111-4111-a111-111111111111";
const CHILD_CONVERSATION_ID = "22222222-2222-4222-a222-222222222222";
const PARENT_MESSAGE_ID = "33333333-3333-4333-a333-333333333333";
const CHILD_MESSAGE_ID = "44444444-4444-4444-8444-444444444444";
const PROJECT_ID = "55555555-5555-4555-8555-555555555555";
const ENVIRONMENT_ID = "77777777-7777-4777-8777-777777777777";
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

function baseSuccessResult(): ChildRunExecutionResult & { success: true } {
  return {
    success: true,
    description: "Inspect logs",
    summary: buildChildRunResultSummary("Found logs"),
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
        text: "invoke_agent failed: setup failed",
        summary: buildChildRunResultSummary("invoke_agent failed: setup failed"),
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
        text: "invoke_agent failed: child failed",
        summary: buildChildRunResultSummary("invoke_agent failed: child failed"),
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
        summary: buildChildRunResultSummary("Found logs"),
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

  it("maps known provider errors from failed snapshots into durable invoke terminal codes", () => {
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
    const result: ChildRunExecutionResult = {
      success: false,
      description: "Inspect logs",
      error:
        'veryfront-cloud request failed: {"slug":"insufficient-credits","error":"AI credit limit exceeded","suggestion":"Purchase credits."}',
      steps: 0,
      toolCalls: [],
      toolResults: [],
      durationMs: 12,
    };

    const durableResult = buildHostedDurableChildInvokeSuccessResult({
      result,
      snapshot: buildChildRunExecutionSnapshot(result),
      identifiers,
      targets,
    });

    assertEquals(durableResult.terminalErrorCode, "INSUFFICIENT_CREDITS");
    assertEquals(durableResult.terminalErrorMessage, "Purchase credits.");
  });

  it("sanitizes malformed child transcript text in durable invoke success results", () => {
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
    const result: ChildRunExecutionResult = {
      ...baseSuccessResult(),
      summary: {
        text:
          '<function_calls><invoke name="run_bash"><parameter name="command">curl -s https://example.com</parameter></invoke></function_calls><function_result>Title: Example Content</parameter></invoke></function_calls>',
      },
    };

    assertEquals(
      buildHostedDurableChildInvokeSuccessResult({
        result,
        snapshot: buildChildRunExecutionSnapshot(result),
        identifiers,
        targets,
      }),
      {
        ok: true,
        status: "completed",
        text: "Title: Example Content",
        summary: buildChildRunResultSummary("Title: Example Content"),
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

  it("keeps durable invoke summaries bounded unless full result mode is requested", () => {
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
    const fullResultText = [
      "# Create an agent",
      "x".repeat(64_500),
      '    "model": "anthropic/claude-sonnet-4-6"',
    ].join("\n");
    const snapshot = {
      ...buildChildRunExecutionSnapshot(baseSuccessResult()),
      fullResultText,
    };

    const defaultResult = buildHostedDurableChildInvokeSuccessResult({
      result: baseSuccessResult(),
      snapshot,
      identifiers,
      targets,
    });
    assertEquals(defaultResult.summary?.truncated, true);
    assertStringIncludes(defaultResult.text ?? "", "[truncated");

    const fullResult = buildHostedDurableChildInvokeSuccessResult(
      {
        result: baseSuccessResult(),
        snapshot,
        identifiers,
        targets,
      },
      { resultMode: "full" },
    );
    assertEquals(fullResult.summary?.truncated, false);
    assertEquals(fullResult.summary?.originalChars, fullResultText.length);
    assertStringIncludes(fullResult.text ?? "", '"model": "anthropic/claude-sonnet-4-6"');
  });

  it("preserves existing durable summary metadata when full snapshot text is unavailable", () => {
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
    const fullResultText = [
      "# Create an agent",
      "x".repeat(64_500),
      '    "model": "anthropic/claude-sonnet-4-6"',
    ].join("\n");
    const result: ChildRunExecutionResult = {
      ...baseSuccessResult(),
      summary: buildChildRunResultSummary(fullResultText),
    };
    const snapshot = {
      ...buildChildRunExecutionSnapshot(result),
      fullResultText: null,
    };

    const fullResult = buildHostedDurableChildInvokeSuccessResult(
      {
        result,
        snapshot,
        identifiers,
        targets,
      },
      { resultMode: "full" },
    );

    assertEquals(fullResult.summary?.truncated, true);
    assertStringIncludes(fullResult.text ?? "", "[truncated");
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
      "gen_ai.usage.total_tokens": 7,
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
        text: "invoke_agent failed: setup failed",
        summary: buildChildRunResultSummary("invoke_agent failed: setup failed"),
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
      "target.branch.id": BRANCH_ID,
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
      "target.branch.id": BRANCH_ID,
      "agent.run.final_status": "completed",
      "tool.name": "invoke_agent",
      "tool.call.id": "tool-call-1",
      "gen_ai.operation.name": "execute_tool",
      "gen_ai.tool.name": "invoke_agent",
      "gen_ai.tool.type": "function",
      "gen_ai.tool.call.id": "tool-call-1",
      "gen_ai.usage.input_tokens": 3,
      "gen_ai.usage.output_tokens": 4,
      "gen_ai.usage.total_tokens": 7,
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

  it("returns local child full snapshot text when full result mode is requested", async () => {
    const fullResultText = [
      "# Create an agent",
      "x".repeat(64_500),
      '    "model": "anthropic/claude-sonnet-4-6"',
    ].join("\n");
    const localResult = baseSuccessResult();
    const result = await executeHostedLocalChildInvoke({
      forkInput: { description: "Inspect logs" },
      traceRecorder: {
        recordLocalResult: (recordedResult) => recordedResult,
        recordLocalFailure: () => {},
      },
      execute: () => localResult,
      getExecutionSnapshot: () => ({
        ...buildChildRunExecutionSnapshot(localResult),
        fullResultText,
      }),
      resultMode: "full",
    });

    assertEquals(result.success, true);
    if (result.success) {
      assertEquals(result.summary.truncated, false);
      assertEquals(result.summary.originalChars, fullResultText.length);
      assertStringIncludes(result.summary.text, '"model": "anthropic/claude-sonnet-4-6"');
    }
  });

  it("preserves local child summary metadata when full snapshot text is unavailable", async () => {
    const fullResultText = [
      "# Create an agent",
      "x".repeat(64_500),
      '    "model": "anthropic/claude-sonnet-4-6"',
    ].join("\n");
    const localResult: ChildRunExecutionResult = {
      ...baseSuccessResult(),
      summary: buildChildRunResultSummary(fullResultText),
    };
    const result = await executeHostedLocalChildInvoke({
      forkInput: { description: "Inspect logs" },
      traceRecorder: {
        recordLocalResult: (recordedResult) => recordedResult,
        recordLocalFailure: () => {},
      },
      execute: () => localResult,
      getExecutionSnapshot: () => null,
      resultMode: "full",
    });

    assertEquals(result.success, true);
    if (result.success) {
      assertEquals(result.summary.truncated, true);
      assertStringIncludes(result.summary.text, "[truncated");
    }
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
        forkInput: { description: "Inspect logs", prompt: "Find logs", context: {} },
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

  it("bootstraps environment-targeted child runs and returns host-shaped success", async () => {
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
          context: {
            veryfront_invocation_context: {
              root_conversation_id: "root-conversation-1",
              root_run_id: "run_root_1",
            },
          },
        },
        executionOptions: { toolCallId: "tool-call-1" },
        childAgentId: "invoke-agent-child",
        runProjectId: projectId,
        parentConversationId: PARENT_CONVERSATION_ID,
        parentRunId: "run_parent_1",
        parentMessageId: PARENT_MESSAGE_ID,
        getProjectId: () => projectId,
        getRuntimeTargetKind: () => "environment",
        getRuntimeTargetEnvironmentId: () => ENVIRONMENT_ID,
        getBranchId: () => null,
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
      sourceTargetKind: "environment",
      runtimeTargetKind: "environment",
      targetEnvironmentId: ENVIRONMENT_ID,
      targetBranchId: null,
    });
    assertEquals(result.success.snapshot.success, true);
    const handoffMessageBody = getRecordedRequest(requests, 2).body;
    assertEquals(handoffMessageBody, {
      role: "user",
      parts: [
        {
          type: "text",
          text:
            'Find logs\n\n<structured_context>\n{"veryfront_invocation_context":{"root_conversation_id":"root-conversation-1","root_run_id":"run_root_1","parent_conversation_id":"11111111-1111-4111-a111-111111111111","parent_run_id":"run_parent_1","tool_call_id":"tool-call-1"}}\n</structured_context>\nTreat structured_context as the authoritative data payload for the child task. If prose conflicts with structured_context, use structured_context and say what conflicted.',
        },
      ],
    });
    const createRunBody = getRecordedRequest(requests, 3).body;
    assertEquals(createRunBody, {
      kind: "agent",
      owner: {
        kind: "conversation",
        id: CHILD_CONVERSATION_ID,
      },
      public_id: getPublicId(createRunBody),
      parent_run_id: "run_parent_1",
      request: {
        mode: "agent",
        agent_id: "invoke-agent-child",
        initial_status: "running",
        source_target_kind: "environment",
        runtime_target_kind: "environment",
        source_target_environment_id: ENVIRONMENT_ID,
        runtime_target_environment_id: ENVIRONMENT_ID,
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
