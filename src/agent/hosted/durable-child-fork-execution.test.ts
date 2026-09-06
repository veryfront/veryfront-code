import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
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
  getHostedDurableChildInvokeResultSchema,
  HostedChildRunFinalizationError,
  type HostedDurableChildSetupFailure,
  type HostedDurableChildSuccess,
  type HostedDurableChildTerminalFailure,
} from "./durable-child-fork-execution.ts";
import type { InvokeAgentChildRunProgressEvent } from "../child-run/invoke-agent-child-runs.ts";
import { bootstrapHostedChildRun, type BootstrapHostedChildRunInput } from "./child-bootstrap.ts";
import {
  createHostedRunEventWriterCapability,
  getActiveHostedRunEventWriterCapability,
  runWithHostedRunEventWriterCapability,
} from "./child-run-event-writer-token.ts";

const API_URL = "https://api.example.com";
const AUTH_TOKEN = "token-123";
const PARENT_RUN_EVENT_TOKEN = "parent-run-event-token";
const CHILD_RUN_EVENT_TOKEN = "child-run-event-token";
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
  | { status: "terminal_failed"; failure: HostedDurableChildTerminalFailure }
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

const INJECTED_CHILD_IDENTIFIERS = {
  childConversationId: CHILD_CONVERSATION_ID,
  childRunId: "run_child_1",
  childMessageId: CHILD_MESSAGE_ID,
  latestEventId: 7,
  latestExternalEventSequence: 3,
};

type InjectedRunLifecycle = NonNullable<
  NonNullable<
    Parameters<
      typeof executeHostedDurableChildFork<DurableChildResult, ChildRunExecutionResult>
    >[0][
      "runtime"
    ]
  >["runLifecycle"]
>;

function runForkWithInjectedLifecycle(input: {
  runLifecycle: () => ReturnType<InjectedRunLifecycle>;
  buildTerminalFailureResult: (failure: HostedDurableChildTerminalFailure) => DurableChildResult;
  onLifecycleFinalized?: Parameters<
    typeof executeHostedDurableChildFork<DurableChildResult, ChildRunExecutionResult>
  >[0]["onLifecycleFinalized"];
}): Promise<DurableChildResult> {
  const capability = createHostedRunEventWriterCapability({
    apiUrl: API_URL,
    runId: "run_parent_1",
    runEventAppendToken: PARENT_RUN_EVENT_TOKEN,
    fetch: () =>
      Promise.resolve(Response.json(
        { run_event_token: CHILD_RUN_EVENT_TOKEN },
        { headers: { "Cache-Control": "no-store" } },
      )),
  });

  return runWithHostedRunEventWriterCapability(
    capability,
    () =>
      executeHostedDurableChildFork<DurableChildResult, ChildRunExecutionResult>({
        authToken: AUTH_TOKEN,
        apiUrl: API_URL,
        forkInput: { description: "Inspect logs", prompt: "Find logs", context: {} },
        executionOptions: { toolCallId: "tool-call-1" },
        childAgentId: "invoke-agent-child",
        parentConversationId: PARENT_CONVERSATION_ID,
        parentRunId: "run_parent_1",
        parentMessageId: PARENT_MESSAGE_ID,
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
        buildTerminalFailureResult: input.buildTerminalFailureResult,
        buildSuccessResult: (success) => ({ status: "completed", success }),
        onLifecycleFinalized: input.onLifecycleFinalized,
        runtime: {
          bootstrapChildRun: () =>
            Promise.resolve({ ...INJECTED_CHILD_IDENTIFIERS, status: "running" }),
          createLifecycleAdapter: () => ({}),
          runLifecycle: input.runLifecycle as InjectedRunLifecycle,
        },
      }),
  );
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
    assertEquals(
      durableResult.terminalErrorMessage,
      "Insufficient AI credits. Purchase additional credits or upgrade your subscription plan.",
    );
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
    const result = {
      ...baseSuccessResult(),
      summary: {
        text:
          '<function_calls><invoke name="run_bash"><parameter name="command">curl -s https://example.com</parameter></invoke></function_calls><function_result>Title: Example Content</parameter></invoke></function_calls>',
      },
    } as ChildRunExecutionResult;

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

  it("rebuilds durable invoke structured facts from stored full child text", () => {
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
      '    "tool_ids": ["harvest__list_time_entries"]',
    ].join("\n");
    const snapshot = {
      ...buildChildRunExecutionSnapshot(baseSuccessResult()),
      fullResultText,
    };

    const structuredResult = buildHostedDurableChildInvokeSuccessResult(
      {
        result: baseSuccessResult(),
        snapshot,
        identifiers,
        targets,
      },
      { resultMode: "structured" },
    );

    assertEquals(structuredResult.summary?.truncated, true);
    assertEquals(structuredResult.text?.includes("anthropic/claude-sonnet-4-6"), false);
    assertEquals(structuredResult.summary?.contractFacts, {
      modelIds: ["anthropic/claude-sonnet-4-6"],
      toolIds: ["harvest__list_time_entries"],
    });
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
    const capturedBootstrapInputs: BootstrapHostedChildRunInput[] = [];
    const exchangeRequests: Request[] = [];
    const runEventWriterCapability = createHostedRunEventWriterCapability({
      apiUrl: API_URL,
      runId: "run_parent_1",
      runEventAppendToken: PARENT_RUN_EVENT_TOKEN,
      fetch: (input, init) => {
        const request = new Request(input, init);
        exchangeRequests.push(request);
        return Promise.resolve(Response.json(
          {
            run_event_token: exchangeRequests.length === 1
              ? CHILD_RUN_EVENT_TOKEN
              : "grandchild-run-event-token",
          },
          { headers: { "Cache-Control": "no-store" } },
        ));
      },
    });
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

    const result = await runWithHostedRunEventWriterCapability(
      runEventWriterCapability,
      () =>
        executeHostedDurableChildFork<DurableChildResult, ChildRunExecutionResult>(
          {
            authToken: AUTH_TOKEN,
            apiUrl: API_URL,
            forkInput: {
              description: "Inspect logs",
              prompt: "Find logs",
              project_reference: "target-project",
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
            trustedInvocationContext: {
              root_conversation_id: "root-conversation-1",
              root_run_id: "run_root_1",
              delegation_depth: 0,
            },
            getProjectId: () => projectId,
            getRuntimeTargetKind: () => "environment",
            getRuntimeTargetEnvironmentId: () => ENVIRONMENT_ID,
            getBranchId: () => null,
            getContextModel: () => "sonnet",
            defaultModel: "opus",
            resolveModelId: (model) => `resolved-${model}`,
            resolveProvider: (model) => `provider-${model}`,
            resolveProjectReference: ({ projectReference }) => {
              assertEquals(projectReference, "target-project");
              return Promise.resolve({
                projectId: "77777777-7777-4777-8777-777777777777",
                slug: "target-project",
              });
            },
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
            executeLocal: async (options) => {
              assertEquals(JSON.stringify(options).includes(CHILD_RUN_EVENT_TOKEN), false);
              assertEquals("runEventWriterCapability" in (options ?? {}), false);
              const grandchildCapability = await getActiveHostedRunEventWriterCapability()
                ?.mintChildRunEventWriterCapability("run_grandchild_1");
              assertEquals(JSON.stringify(grandchildCapability), "{}");
              bootstrapCalls.push("execute");
              return baseSuccessResult();
            },
            getExecutionSnapshot: () => null,
            buildContextUnavailableResult: (message) => ({ status: "missing_context", message }),
            buildSetupFailureResult: (failure) => ({ status: "setup_failed", failure }),
            buildTerminalFailureResult: () => ({
              status: "missing_context",
              message: "unexpected",
            }),
            buildSuccessResult: (success) => ({ status: "completed", success }),
            runtime: {
              bootstrapChildRun: (input) => {
                capturedBootstrapInputs.push(input);
                return bootstrapHostedChildRun(input);
              },
            },
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
        ),
    );

    if (result.status !== "completed") {
      throw new Error("Expected completed result");
    }

    assertEquals(projectId, "77777777-7777-4777-8777-777777777777");
    assertEquals(
      capturedBootstrapInputs[0]?.ensureProjectId,
      "77777777-7777-4777-8777-777777777777",
    );
    assertEquals(capturedBootstrapInputs[0]?.authToken, AUTH_TOKEN);
    assertEquals(capturedBootstrapInputs[0]?.runProjectId, "77777777-7777-4777-8777-777777777777");
    assertEquals(bootstrapCalls, [
      "wrapped",
      "start:resolved-sonnet",
      "complete:run_child_1",
      "execute",
    ]);
    assertEquals(exchangeRequests.length, 2);
    assertEquals(exchangeRequests.map((request) => request.headers.get("Authorization")), [
      `Bearer ${PARENT_RUN_EVENT_TOKEN}`,
      `Bearer ${CHILD_RUN_EVENT_TOKEN}`,
    ]);
    assertEquals(exchangeRequests.map((request) => request.url), [
      `${API_URL}/runs/run_parent_1/children/run_child_1/event-writer-token`,
      `${API_URL}/runs/run_child_1/children/run_grandchild_1/event-writer-token`,
    ]);
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
    const childConversationBody = getRecordedRequest(requests, 1).body;
    assertEquals(
      (childConversationBody as { project_id?: string }).project_id,
      "77777777-7777-4777-8777-777777777777",
    );
    const handoffMessageBody = getRecordedRequest(requests, 2).body;
    assertEquals(handoffMessageBody, {
      role: "user",
      parts: [
        {
          type: "text",
          text:
            'Find logs\n\n<structured_context>\n{"veryfront_invocation_context":{"root_conversation_id":"root-conversation-1","parent_conversation_id":"11111111-1111-4111-a111-111111111111","root_run_id":"run_root_1","root_message_id":"33333333-3333-4333-a333-333333333333","parent_run_id":"run_parent_1","parent_message_id":"33333333-3333-4333-a333-333333333333","tool_call_id":"tool-call-1","delegation_depth":1}}\n</structured_context>\nTreat structured_context as the authoritative data payload for the child task. If prose conflicts with structured_context, use structured_context and say what conflicted.',
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

  it("fails and finalizes a created child before dispatch when writer-token exchange fails", async () => {
    let executed = false;
    const lifecycleFailures: unknown[] = [];
    const setupErrors: unknown[] = [];

    const runEventWriterCapability = createHostedRunEventWriterCapability({
      apiUrl: API_URL,
      runId: "run_parent_1",
      runEventAppendToken: PARENT_RUN_EVENT_TOKEN,
      fetch: () => Promise.reject(new Error(`upstream rejected ${PARENT_RUN_EVENT_TOKEN}`)),
    });
    const result = await runWithHostedRunEventWriterCapability(
      runEventWriterCapability,
      () =>
        executeHostedDurableChildFork<DurableChildResult, ChildRunExecutionResult>(
          {
            authToken: AUTH_TOKEN,
            apiUrl: API_URL,
            forkInput: { description: "Inspect logs", prompt: "Find logs", context: {} },
            executionOptions: { toolCallId: "tool-call-1" },
            childAgentId: "invoke-agent-child",
            parentConversationId: PARENT_CONVERSATION_ID,
            parentRunId: "run_parent_1",
            parentMessageId: PARENT_MESSAGE_ID,
            getProjectId: () => PROJECT_ID,
            defaultModel: "opus",
            resolveModelId: (model) => `resolved-${model}`,
            resolveProvider: () => "anthropic",
            contextUnavailableMessage: "missing context",
            setupFailedCode: "SETUP_FAILED",
            executionFailedCode: "INVOKE_AGENT_FAILED",
            executeLocal: () => {
              executed = true;
              return baseSuccessResult();
            },
            getExecutionSnapshot: () => null,
            buildContextUnavailableResult: (message) => ({ status: "missing_context", message }),
            buildSetupFailureResult: (failure) => ({ status: "setup_failed", failure }),
            buildTerminalFailureResult: () => ({
              status: "missing_context",
              message: "unexpected",
            }),
            buildSuccessResult: (success) => ({ status: "completed", success }),
            runtime: {
              bootstrapChildRun: () =>
                Promise.resolve({
                  childConversationId: CHILD_CONVERSATION_ID,
                  childRunId: "run_child_1",
                  childMessageId: CHILD_MESSAGE_ID,
                  latestEventId: 7,
                  latestExternalEventSequence: 3,
                  status: "running",
                }),
              createLifecycleAdapter: (input) => {
                assertEquals(input.authToken, AUTH_TOKEN);
                return {
                  failed: (terminalState) => {
                    lifecycleFailures.push(terminalState);
                  },
                };
              },
            },
            bootstrap: {
              onBootstrapError: ({ error }) => {
                setupErrors.push(error);
              },
            },
          },
        ),
    );

    assertEquals(executed, false);
    assertEquals(lifecycleFailures, [{
      status: "failed",
      terminalErrorCode: "SETUP_FAILED",
      terminalErrorMessage: "Unable to initialize durable child event persistence",
    }]);
    assertEquals(setupErrors.length, 1);
    assertEquals(
      setupErrors.some((error) => String(error).includes(PARENT_RUN_EVENT_TOKEN)),
      false,
    );
    assertEquals(result, {
      status: "setup_failed",
      failure: {
        targets: {
          sourceTargetKind: "project",
          runtimeTargetKind: "main_branch",
          targetEnvironmentId: null,
          targetBranchId: null,
        },
        childConversationId: CHILD_CONVERSATION_ID,
        childRunId: "run_child_1",
        childMessageId: CHILD_MESSAGE_ID,
        terminalErrorCode: "SETUP_FAILED",
        terminalErrorMessage: "Unable to initialize durable child event persistence",
      },
    });
    const serializedFailure = JSON.stringify({ result, lifecycleFailures, setupErrors });
    assertEquals(serializedFailure.includes(PARENT_RUN_EVENT_TOKEN), false);
    assertEquals(serializedFailure.includes(CHILD_RUN_EVENT_TOKEN), false);
  });

  it("rejects with a sanitized error after setup-failure finalization is rejected", async () => {
    let finalizationAttempts = 0;
    let executed = false;
    const observedLifecycleErrors: unknown[] = [];
    const runEventWriterCapability = createHostedRunEventWriterCapability({
      apiUrl: API_URL,
      runId: "run_parent_1",
      runEventAppendToken: PARENT_RUN_EVENT_TOKEN,
      fetch: () => Promise.reject(new Error(`secret ${PARENT_RUN_EVENT_TOKEN}`)),
    });
    const execution = runWithHostedRunEventWriterCapability(
      runEventWriterCapability,
      () =>
        executeHostedDurableChildFork<DurableChildResult, ChildRunExecutionResult>(
          {
            authToken: AUTH_TOKEN,
            apiUrl: API_URL,
            forkInput: { description: "Inspect logs", prompt: "Find logs", context: {} },
            executionOptions: { toolCallId: "tool-call-1" },
            childAgentId: "invoke-agent-child",
            parentConversationId: PARENT_CONVERSATION_ID,
            parentRunId: "run_parent_1",
            parentMessageId: PARENT_MESSAGE_ID,
            getProjectId: () => PROJECT_ID,
            defaultModel: "opus",
            resolveModelId: (model) => `resolved-${model}`,
            resolveProvider: () => "anthropic",
            contextUnavailableMessage: "missing context",
            setupFailedCode: "SETUP_FAILED",
            executionFailedCode: "INVOKE_AGENT_FAILED",
            executeLocal: () => {
              executed = true;
              return baseSuccessResult();
            },
            getExecutionSnapshot: () => null,
            buildContextUnavailableResult: (message) => ({ status: "missing_context", message }),
            buildSetupFailureResult: (failure) => ({ status: "setup_failed", failure }),
            buildTerminalFailureResult: () => ({
              status: "missing_context",
              message: "unexpected",
            }),
            buildSuccessResult: (success) => ({ status: "completed", success }),
            runtime: {
              bootstrapChildRun: () =>
                Promise.resolve({
                  childConversationId: CHILD_CONVERSATION_ID,
                  childRunId: "run_child_1",
                  childMessageId: CHILD_MESSAGE_ID,
                  latestEventId: 7,
                  latestExternalEventSequence: 3,
                  status: "running",
                }),
              createLifecycleAdapter: () => ({
                failed: () => {
                  finalizationAttempts += 1;
                  return Promise.reject(new Error(`finalization secret ${CHILD_RUN_EVENT_TOKEN}`));
                },
              }),
            },
            bootstrap: {
              onBootstrapError: () => Promise.reject(new Error("observer failed")),
            },
            onLifecycleError: (error) => {
              observedLifecycleErrors.push(error);
              if (error instanceof HostedChildRunFinalizationError) {
                return Promise.reject(new Error("finalization observer failed"));
              }
            },
          },
        ),
    );
    const error = await assertRejects(
      () => execution,
      HostedChildRunFinalizationError,
      "Unable to finalize durable child run after setup failure",
    );

    assertEquals(executed, false);
    assertEquals(finalizationAttempts, 1);
    assertEquals(observedLifecycleErrors.length, 2);
    assertEquals(
      observedLifecycleErrors[0] instanceof Error &&
        observedLifecycleErrors[0].message === "observer failed",
      true,
    );
    assertEquals(observedLifecycleErrors[1] instanceof HostedChildRunFinalizationError, true);
    assertEquals(
      observedLifecycleErrors[1] instanceof Error && observedLifecycleErrors[1].message,
      "Unable to finalize durable child run after setup failure",
    );
    assertEquals(
      observedLifecycleErrors[1] instanceof Error && "cause" in observedLifecycleErrors[1],
      false,
    );
    assertEquals(JSON.stringify(observedLifecycleErrors).includes(CHILD_RUN_EVENT_TOKEN), false);
    assertEquals(error instanceof HostedChildRunFinalizationError, true);
    assertEquals(error instanceof Error && "cause" in error, false);
  });

  it("reports missing setup-failure terminal persistence as a finalization error", async () => {
    let executed = false;
    const observedLifecycleErrors: unknown[] = [];
    const runEventWriterCapability = createHostedRunEventWriterCapability({
      apiUrl: API_URL,
      runId: "run_parent_1",
      runEventAppendToken: PARENT_RUN_EVENT_TOKEN,
      fetch: () => Promise.reject(new Error(`secret ${PARENT_RUN_EVENT_TOKEN}`)),
    });
    const execution = runWithHostedRunEventWriterCapability(
      runEventWriterCapability,
      () =>
        executeHostedDurableChildFork<DurableChildResult, ChildRunExecutionResult>(
          {
            authToken: AUTH_TOKEN,
            apiUrl: API_URL,
            forkInput: { description: "Inspect logs", prompt: "Find logs", context: {} },
            executionOptions: { toolCallId: "tool-call-1" },
            childAgentId: "invoke-agent-child",
            parentConversationId: PARENT_CONVERSATION_ID,
            parentRunId: "run_parent_1",
            parentMessageId: PARENT_MESSAGE_ID,
            getProjectId: () => PROJECT_ID,
            defaultModel: "opus",
            resolveModelId: (model) => `resolved-${model}`,
            resolveProvider: () => "anthropic",
            contextUnavailableMessage: "missing context",
            setupFailedCode: "SETUP_FAILED",
            executionFailedCode: "INVOKE_AGENT_FAILED",
            executeLocal: () => {
              executed = true;
              return baseSuccessResult();
            },
            getExecutionSnapshot: () => null,
            buildContextUnavailableResult: (message) => ({ status: "missing_context", message }),
            buildSetupFailureResult: (failure) => ({ status: "setup_failed", failure }),
            buildTerminalFailureResult: () => ({
              status: "missing_context",
              message: "unexpected",
            }),
            buildSuccessResult: (success) => ({ status: "completed", success }),
            runtime: {
              bootstrapChildRun: () =>
                Promise.resolve({
                  childConversationId: CHILD_CONVERSATION_ID,
                  childRunId: "run_child_1",
                  childMessageId: CHILD_MESSAGE_ID,
                  latestEventId: 7,
                  latestExternalEventSequence: 3,
                  status: "running",
                }),
              createLifecycleAdapter: () => ({}),
            },
            onLifecycleError: (error) => {
              observedLifecycleErrors.push(error);
            },
          },
        ),
    );
    const error = await assertRejects(
      () => execution,
      HostedChildRunFinalizationError,
      "Unable to finalize durable child run after setup failure",
    );

    assertEquals(executed, false);
    assertEquals(observedLifecycleErrors.length, 1);
    assertEquals(observedLifecycleErrors[0] instanceof HostedChildRunFinalizationError, true);
    assertEquals(error instanceof HostedChildRunFinalizationError, true);
    assertEquals(JSON.stringify(observedLifecycleErrors).includes(PARENT_RUN_EVENT_TOKEN), false);
  });

  it("cancels exactly once when writer-token exchange is aborted after bootstrap", async () => {
    const controller = new AbortController();
    let executed = false;
    let cancellationAttempts = 0;
    const observedLifecycleErrors: unknown[] = [];
    const capability = createHostedRunEventWriterCapability({
      apiUrl: API_URL,
      runId: "run_parent_1",
      runEventAppendToken: PARENT_RUN_EVENT_TOKEN,
      fetch: (input, init) => {
        const signal = new Request(input, init).signal;
        controller.abort(`secret ${PARENT_RUN_EVENT_TOKEN}`);
        return Promise.reject(signal.reason);
      },
    });

    const execution = runWithHostedRunEventWriterCapability(
      capability,
      () =>
        executeHostedDurableChildFork<DurableChildResult, ChildRunExecutionResult>({
          authToken: AUTH_TOKEN,
          apiUrl: API_URL,
          forkInput: { description: "Inspect logs", prompt: "Find logs", context: {} },
          executionOptions: { toolCallId: "tool-call-1", abortSignal: controller.signal },
          childAgentId: "invoke-agent-child",
          parentConversationId: PARENT_CONVERSATION_ID,
          parentRunId: "run_parent_1",
          parentMessageId: PARENT_MESSAGE_ID,
          getProjectId: () => PROJECT_ID,
          defaultModel: "opus",
          resolveModelId: (model) => `resolved-${model}`,
          resolveProvider: () => "anthropic",
          contextUnavailableMessage: "missing context",
          setupFailedCode: "SETUP_FAILED",
          executionFailedCode: "INVOKE_AGENT_FAILED",
          executeLocal: () => {
            executed = true;
            return baseSuccessResult();
          },
          getExecutionSnapshot: () => null,
          buildContextUnavailableResult: (message) => ({ status: "missing_context", message }),
          buildSetupFailureResult: (failure) => ({ status: "setup_failed", failure }),
          buildTerminalFailureResult: (failure) => ({
            status: "terminal_failed",
            failure,
          }),
          buildSuccessResult: (success) => ({ status: "completed", success }),
          runtime: {
            bootstrapChildRun: () =>
              Promise.resolve({
                childConversationId: CHILD_CONVERSATION_ID,
                childRunId: "run_child_1",
                childMessageId: CHILD_MESSAGE_ID,
                latestEventId: 7,
                latestExternalEventSequence: 3,
                status: "running",
              }),
            createLifecycleAdapter: () => ({
              cancelled: () => {
                cancellationAttempts += 1;
                return Promise.reject(new Error(`finalization ${CHILD_RUN_EVENT_TOKEN}`));
              },
            }),
          },
          bootstrap: {
            onBootstrapError: () => Promise.reject(new Error("observer rejected")),
          },
          onLifecycleError: (error) => {
            observedLifecycleErrors.push(error);
          },
        }),
    );
    const error = await assertRejects(
      () => execution,
      HostedChildRunFinalizationError,
      "Unable to finalize durable child run after setup failure",
    );

    assertEquals(executed, false);
    assertEquals(cancellationAttempts, 1);
    assertEquals(error instanceof HostedChildRunFinalizationError, true);
    assertEquals(observedLifecycleErrors.length, 2);
    assertEquals(
      observedLifecycleErrors[0] instanceof Error && observedLifecycleErrors[0].message,
      "observer rejected",
    );
    assertEquals(observedLifecycleErrors[1] instanceof HostedChildRunFinalizationError, true);
    assertEquals(
      JSON.stringify(observedLifecycleErrors).includes(PARENT_RUN_EVENT_TOKEN),
      false,
    );
    assertEquals(
      JSON.stringify(observedLifecycleErrors).includes(CHILD_RUN_EVENT_TOKEN),
      false,
    );
  });

  it("sanitizes caller cancellation after persisting setup cancellation", async () => {
    const controller = new AbortController();
    let executed = false;
    let cancellationAttempts = 0;
    const callerAbort = new DOMException("caller cancelled", "AbortError");
    const capability = createHostedRunEventWriterCapability({
      apiUrl: API_URL,
      runId: "run_parent_1",
      runEventAppendToken: PARENT_RUN_EVENT_TOKEN,
      fetch: () => {
        controller.abort(callerAbort);
        return Promise.reject(callerAbort);
      },
    });

    const error = await assertRejects(
      () =>
        executeHostedDurableChildFork<DurableChildResult, ChildRunExecutionResult>({
          authToken: AUTH_TOKEN,
          apiUrl: API_URL,
          runEventWriterCapability: capability,
          forkInput: { description: "Inspect logs", prompt: "Find logs", context: {} },
          executionOptions: { toolCallId: "tool-call-1", abortSignal: controller.signal },
          childAgentId: "invoke-agent-child",
          parentConversationId: PARENT_CONVERSATION_ID,
          parentRunId: "run_parent_1",
          parentMessageId: PARENT_MESSAGE_ID,
          getProjectId: () => PROJECT_ID,
          defaultModel: "opus",
          resolveModelId: (model) => `resolved-${model}`,
          resolveProvider: () => "anthropic",
          contextUnavailableMessage: "missing context",
          setupFailedCode: "SETUP_FAILED",
          executionFailedCode: "INVOKE_AGENT_FAILED",
          executeLocal: () => {
            executed = true;
            return baseSuccessResult();
          },
          getExecutionSnapshot: () => null,
          buildContextUnavailableResult: (message) => ({ status: "missing_context", message }),
          buildSetupFailureResult: (failure) => ({ status: "setup_failed", failure }),
          buildTerminalFailureResult: (failure) => ({ status: "terminal_failed", failure }),
          buildSuccessResult: (success) => ({ status: "completed", success }),
          runtime: {
            bootstrapChildRun: () =>
              Promise.resolve({
                childConversationId: CHILD_CONVERSATION_ID,
                childRunId: "run_child_1",
                childMessageId: CHILD_MESSAGE_ID,
                latestEventId: 7,
                latestExternalEventSequence: 3,
                status: "running",
              }),
            createLifecycleAdapter: () => ({
              cancelled: () => {
                cancellationAttempts += 1;
                return Promise.resolve();
              },
            }),
          },
        }),
      DOMException,
      "The operation was aborted.",
    );

    assertEquals(error === callerAbort, false);
    if (!(error instanceof DOMException)) {
      throw new Error("Expected a sanitized AbortError");
    }
    assertEquals(error.name, "AbortError");
    assertEquals(error.message.includes(callerAbort.message), false);
    assertEquals(executed, false);
    assertEquals(cancellationAttempts, 1);
  });

  it("maps null lifecycle terminal codes to executionFailedCode and Unknown error", async () => {
    const recordedTerminalInputs: HostedDurableChildTerminalFailure[] = [];

    const result = await runForkWithInjectedLifecycle({
      runLifecycle: () =>
        Promise.resolve({
          status: "failed" as const,
          error: new Error("child failed"),
          terminalState: {
            status: "failed" as const,
            terminalErrorCode: null,
            terminalErrorMessage: null,
          },
        }),
      buildTerminalFailureResult: (failure) => {
        recordedTerminalInputs.push(failure);
        return { status: "terminal_failed", failure };
      },
    });

    assertEquals(result.status, "terminal_failed");
    assertEquals(
      recordedTerminalInputs,
      [{
        status: "failed",
        identifiers: INJECTED_CHILD_IDENTIFIERS,
        targets: {
          sourceTargetKind: "project",
          runtimeTargetKind: "main_branch",
          targetEnvironmentId: null,
          targetBranchId: null,
        },
        terminalErrorCode: "INVOKE_AGENT_FAILED",
        terminalErrorMessage: "Unknown error",
      }],
      "null terminal codes must fall back to executionFailedCode and Unknown error",
    );
  });

  it("rethrows lifecycle cancellations that are not external terminal states", async () => {
    const recordedTerminalInputs: HostedDurableChildTerminalFailure[] = [];

    const thrown = await assertRejects(
      () =>
        runForkWithInjectedLifecycle({
          runLifecycle: () =>
            Promise.resolve({
              status: "cancelled" as const,
              error: new Error("caller abort"),
              terminalState: {
                status: "cancelled" as const,
                terminalErrorCode: "CANCELLED",
                terminalErrorMessage: "Child run cancelled",
              },
            }),
          buildTerminalFailureResult: (failure) => {
            recordedTerminalInputs.push(failure);
            return { status: "terminal_failed", failure };
          },
        }),
      Error,
    );

    assertInstanceOf(thrown, Error, "the rethrown cancellation must be an Error");
    assertEquals(
      thrown.message,
      "caller abort",
      "a non-terminal-state cancellation must be rethrown",
    );
    assertEquals(
      recordedTerminalInputs.length,
      0,
      "a rethrown cancellation must not build a terminal failure result",
    );
  });

  it("fires onLifecycleFinalized once with identifiers on completion", async () => {
    const finalized: unknown[] = [];
    const localResult = baseSuccessResult();

    const result = await runForkWithInjectedLifecycle({
      runLifecycle: () =>
        Promise.resolve({
          status: "completed" as const,
          result: localResult,
          snapshot: buildChildRunExecutionSnapshot(localResult),
          terminalState: {
            status: "completed" as const,
            terminalErrorCode: null,
            terminalErrorMessage: null,
          },
        }),
      buildTerminalFailureResult: () => ({ status: "missing_context", message: "unexpected" }),
      onLifecycleFinalized: (input) => {
        finalized.push(input);
      },
    });

    assertEquals(result.status, "completed");
    assertEquals(
      finalized,
      [{ identifiers: INJECTED_CHILD_IDENTIFIERS, status: "completed" }],
      "onLifecycleFinalized must fire once with identifiers on completion",
    );
  });

  it("keeps a rejecting bootstrap observer from masking the bootstrap failure", async () => {
    const callbackErrors: unknown[] = [];
    const result = await executeHostedDurableChildFork<DurableChildResult, ChildRunExecutionResult>(
      {
        authToken: AUTH_TOKEN,
        apiUrl: API_URL,
        forkInput: { description: "Inspect logs", prompt: "Find logs", context: {} },
        executionOptions: { toolCallId: "tool-call-1" },
        childAgentId: "invoke-agent-child",
        parentConversationId: PARENT_CONVERSATION_ID,
        parentRunId: "run_parent_1",
        parentMessageId: PARENT_MESSAGE_ID,
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
        runtime: {
          bootstrapChildRun: () => Promise.reject(new Error("bootstrap failed")),
        },
        bootstrap: {
          onBootstrapError: () => Promise.reject(new Error("observer failed")),
        },
        onLifecycleError: (error) => {
          callbackErrors.push(error);
        },
      },
    );

    assertEquals(callbackErrors.length, 1);
    assertStringIncludes(String(callbackErrors[0]), "observer failed");
    assertEquals(result.status, "setup_failed");
    if (result.status === "setup_failed") {
      assertEquals(result.failure.childRunId, null);
      assertEquals(result.failure.terminalErrorMessage, "bootstrap failed");
    }
  });
});

describe("agent/hosted/durable-child-fork-execution result contract", () => {
  // Consumers read these envelopes back out of conversation history, so the
  // builders must keep matching the published contract.
  // See veryfront/veryfront-issue-inbox#423.
  const targets: ConversationRunTargets = {
    sourceTargetKind: "project",
    runtimeTargetKind: "main_branch",
    targetBranchId: null,
  };
  const identifiers = {
    childConversationId: "9bb28814-9f6c-4893-bf91-2b29a832346f",
    childRunId: "run_dc075263-4b91-462d-9638-9f5fc56537b1",
    childMessageId: "b641646b-b92b-4406-8df9-60d7a325b45e",
    latestEventId: 1,
    latestExternalEventSequence: 0,
  };

  function assertConforms(result: unknown, label: string) {
    const parsed = getHostedDurableChildInvokeResultSchema().safeParse(result);
    assertEquals(
      parsed.success,
      true,
      `${label} must match the published invoke_agent result contract: ${
        parsed.success ? "" : JSON.stringify(parsed.error)
      }`,
    );
  }

  it("a successful child result matches the published contract", () => {
    const localResult: ChildRunExecutionResult = {
      success: true,
      description: "Search docs",
      summary: buildChildRunResultSummary("Child answer."),
      steps: 2,
      toolCalls: [],
      toolResults: [],
      usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
      durationMs: 1234,
    };

    assertConforms(
      buildHostedDurableChildInvokeSuccessResult({
        result: localResult,
        snapshot: buildChildRunExecutionSnapshot(localResult),
        identifiers,
        targets,
      }),
      "the success envelope",
    );
  });

  it("a failed child result matches the published contract", () => {
    assertConforms(
      buildHostedDurableChildInvokeFailureResult({
        terminalErrorCode: "INVOKE_AGENT_FAILED",
        terminalErrorMessage: "provider rejected the request",
        targets,
        childConversationId: identifiers.childConversationId,
        childRunId: identifiers.childRunId,
        childMessageId: identifiers.childMessageId,
      }),
      "the failure envelope",
    );
  });

  it("a terminal failure result matches the published contract", () => {
    assertConforms(
      buildHostedDurableChildInvokeTerminalFailureResult({
        status: "failed",
        terminalErrorCode: "DURABLE_CHILD_FAILED",
        terminalErrorMessage: "child run failed remotely",
        targets,
        identifiers,
      }),
      "the terminal failure envelope",
    );
  });

  it("a setup failure with no identifiers matches the published contract", () => {
    assertConforms(
      buildHostedDurableChildInvokeFailureResult({
        terminalErrorCode: "INVOKE_AGENT_SETUP_FAILED",
        terminalErrorMessage: "bootstrap failed before the child existed",
      }),
      "the setup failure envelope",
    );
  });

  it("rejects a completed envelope that lost a child identifier", () => {
    const localResult: ChildRunExecutionResult = {
      success: true,
      description: "Search docs",
      summary: buildChildRunResultSummary("Child answer."),
      steps: 1,
      toolCalls: [],
      toolResults: [],
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      durationMs: 5,
    };
    const complete = buildHostedDurableChildInvokeSuccessResult({
      result: localResult,
      snapshot: buildChildRunExecutionSnapshot(localResult),
      identifiers,
      targets,
    }) as Record<string, unknown>;
    const { childRunId: _dropped, ...missingIdentifier } = complete;

    assertEquals(
      getHostedDurableChildInvokeResultSchema().safeParse(missingIdentifier).success,
      false,
      "a completed result without childRunId cannot be located by a consumer, so the " +
        "contract must reject it rather than let the drift through",
    );
  });
});
