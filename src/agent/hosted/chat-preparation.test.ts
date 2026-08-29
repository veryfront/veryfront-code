import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { observeFetchRequestInit } from "#veryfront/testing/mock-fetch.ts";
import type { ChatUiMessage } from "#veryfront/chat/types.ts";
import type { HistoricalToolInputCompactionDiagnostic } from "#veryfront/chat/message-prep.ts";
import type { ParsedHostedChatRequest } from "./chat-request-parser.ts";
import { ContextCompactionError } from "./context-budget-manager.ts";
import {
  normalizeParsedHostedChatRequest,
  prepareHostedChatExecution,
  prepareHostedChatRuntimeCreationOptions,
  prepareHostedChatRuntimeMessages,
} from "./chat-preparation.ts";
import { buildVeryfrontCloudRuntimeInstructions } from "./cloud-runtime-system-messages.ts";
import { registerHostedRunEventWriterToken } from "./child-run-event-writer-token.ts";

const userMessage: ChatUiMessage = {
  id: "user-message-1",
  role: "user",
  parts: [{ type: "text", text: "Hello" }],
};

const assistantMessage: ChatUiMessage = {
  id: "assistant-message-1",
  role: "assistant",
  parts: [{ type: "text", text: "Hi" }],
};

function isRuntimeFilePart(
  part: unknown,
): part is { type: "file"; url: string; mediaType: string } {
  return typeof part === "object" && part !== null &&
    "type" in part && part.type === "file" &&
    "url" in part && typeof part.url === "string" &&
    "mediaType" in part && typeof part.mediaType === "string";
}

function isRuntimeTextPart(part: unknown): part is { type: "text"; text: string } {
  return typeof part === "object" && part !== null &&
    "type" in part && part.type === "text" &&
    "text" in part && typeof part.text === "string";
}

function rejectIfStillPending<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): { promise: Promise<T>; cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return {
    promise: Promise.race([promise, timeout]),
    cancel: () => {
      if (timeoutId) clearTimeout(timeoutId);
    },
  };
}

function pendingResponseUntilAbort(signal: AbortSignal | null | undefined): Promise<Response> {
  if (!(signal instanceof AbortSignal)) {
    return new Promise(() => {});
  }

  return new Promise((_resolve, reject) => {
    const rejectAbort = () => {
      reject(signal.reason instanceof Error ? signal.reason : new Error("fetch aborted"));
    };
    if (signal.aborted) {
      rejectAbort();
      return;
    }
    signal.addEventListener("abort", rejectAbort, { once: true });
  });
}

function createParsedHostedChatRequest(
  overrides: Partial<ParsedHostedChatRequest> & { runEventAppendToken?: string } = {},
): ParsedHostedChatRequest {
  const { runEventAppendToken, ...requestOverrides } = overrides;
  const request: ParsedHostedChatRequest = {
    agentId: undefined,
    userId: "user-1",
    authToken: "auth-token",
    messages: [userMessage],
    validatedContext: {
      conversationId: "conversation-from-context",
      projectId: "project-from-context",
      branchId: "branch-from-context",
    },
    projectId: "project-from-context",
    conversationId: "conversation-from-context",
    parentRunId: undefined,
    upstreamParentConversationId: undefined,
    upstreamParentRunId: undefined,
    spawnedFromToolCallId: undefined,
    model: undefined,
    allowDelegation: undefined,
    forwardedProps: undefined,
    runtimeOverrides: undefined,
    durableRootRun: undefined,
    persistLatestUserMessageBeforeDurableRun: false,
    ...requestOverrides,
  };
  if (runEventAppendToken) {
    registerHostedRunEventWriterToken(
      request,
      {
        token: runEventAppendToken,
        projectId: request.projectId ?? "project-from-context",
        runId: request.durableRootRun?.runId ?? "run-1",
        fetch: globalThis.fetch,
      },
    );
  }
  return request;
}

Deno.test("normalizeParsedHostedChatRequest uses the latest user message as parent message id", () => {
  const secondUserMessage: ChatUiMessage = {
    id: "user-message-2",
    role: "user",
    parts: [{ type: "text", text: "Continue" }],
  };
  const messages = [userMessage, assistantMessage, secondUserMessage];

  const normalized = normalizeParsedHostedChatRequest(
    createParsedHostedChatRequest({ messages }),
  );

  assertEquals(normalized.effectiveMessages, messages);
  assertEquals(normalized.parentMessageId, "user-message-2");
});

Deno.test("normalizeParsedHostedChatRequest keeps validated context ahead of top-level values", () => {
  const normalized = normalizeParsedHostedChatRequest(
    createParsedHostedChatRequest({
      projectId: "project-top-level",
      conversationId: "conversation-top-level",
      validatedContext: {
        projectId: "project-context",
        conversationId: "conversation-context",
        branchId: "branch-context",
        environmentContext: "runtime env",
      },
    }),
  );

  assertEquals(normalized.effectiveValidatedContext, {
    projectId: "project-context",
    conversationId: "conversation-context",
    branchId: "branch-context",
    environmentContext: "runtime env",
  });
});

Deno.test("normalizeParsedHostedChatRequest falls back to top-level context values", () => {
  const normalized = normalizeParsedHostedChatRequest(
    createParsedHostedChatRequest({
      projectId: "project-top-level",
      conversationId: "conversation-top-level",
      validatedContext: {
        projectId: null,
        branchId: null,
      },
    }),
  );

  assertEquals(normalized.effectiveValidatedContext, {
    projectId: "project-top-level",
    conversationId: "conversation-top-level",
    branchId: null,
  });
});

Deno.test("prepareHostedChatRuntimeCreationOptions builds runtime options from request, steering, and root context", async () => {
  const skill = {
    id: "debug",
    name: "Debug",
    description: "Debug failures",
    instructions: "Use a systematic debugging workflow.",
    allowedTools: ["bash"],
  };
  const fetchInputs: Array<{
    projectId: string | null;
    authToken: string;
    branchId?: string | null;
  }> = [];
  const parentEvents: unknown[] = [];
  const checkpointPersistenceOperations: string[] = [];
  let publicCheckpointAppends = 0;
  let checkpointFlushComplete = true;

  const result = await prepareHostedChatRuntimeCreationOptions({
    request: createParsedHostedChatRequest({
      allowDelegation: false,
      runEventAppendToken: "root-writer-token",
      model: "requested-model",
      runtimeOverrides: {
        allowedTools: ["load_skill"],
        thinking: false,
        maxSteps: 7,
        maxOutputTokens: 1200,
      },
    }),
    agentConfig: {
      id: "agent-1",
      model: "configured-model",
      thinking: { enabled: true, budgetTokens: 1000 },
      maxSteps: 50,
      tools: ["get_agent", "load_skill", "update_agent"],
    },
    projectId: "project-1",
    authToken: "token-1",
    conversationId: "conversation-1",
    branchId: "branch-1",
    environmentContext: "Browser workspace",
    rootRunContext: {
      durableRootRun: {
        runId: "run-1",
        conversationId: "conversation-1",
        messageId: "message-1",
        latestEventId: 1,
        latestExternalEventSequence: 1,
      },
      effectiveParentRunId: "run-1",
      effectiveParentMessageId: "message-1",
      publishParentRunEvents: (events) => {
        parentEvents.push(...events);
        return Promise.resolve();
      },
      durableRunMirror: {
        handleChunk: () => Promise.resolve(),
        appendEvents: () => {
          publicCheckpointAppends++;
          return Promise.resolve();
        },
        flush: () =>
          Promise.resolve({
            latestEventId: 1,
            latestExternalEventSequence: 1,
            pendingEventCount: 0,
            consecutiveFailures: 0,
            disabled: false,
            hasFlushTimer: false,
            hasRetryTimer: false,
            inFlight: false,
          }),
        getSnapshot: () => ({
          latestEventId: 1,
          latestExternalEventSequence: 1,
          pendingEventCount: 0,
          consecutiveFailures: 0,
          disabled: false,
          hasFlushTimer: false,
          hasRetryTimer: false,
          inFlight: false,
        }),
        dispose: () => {},
      },
      privateDurableRunMirror: {
        handleChunk: () => Promise.resolve(),
        appendEvents: (events) => {
          checkpointPersistenceOperations.push(
            `append:${events.map((event) => event.type).join(",")}`,
          );
          return Promise.resolve();
        },
        flush: () => {
          checkpointPersistenceOperations.push("flush");
          return Promise.resolve({
            latestEventId: 2,
            latestExternalEventSequence: 2,
            pendingEventCount: checkpointFlushComplete ? 0 : 1,
            consecutiveFailures: 0,
            disabled: false,
            hasFlushTimer: false,
            hasRetryTimer: false,
            inFlight: false,
          });
        },
        getSnapshot: () => ({
          latestEventId: 1,
          latestExternalEventSequence: 1,
          pendingEventCount: 0,
          consecutiveFailures: 0,
          disabled: false,
          hasFlushTimer: false,
          hasRetryTimer: false,
          inFlight: false,
        }),
        dispose: () => {
          checkpointPersistenceOperations.push("dispose");
        },
      },
    },
    serverResolvedToolExposureCheckpoint: {
      version: 1,
      loadedToolNames: ["get_release"],
    },
    serverResolvedProviderReplayCheckpoints: [{
      version: 1,
      messageId: "assistant-message-1",
      provider: "anthropic",
      providerBlocks: [{
        type: "provider-block",
        provider: "anthropic",
        block: { type: "thinking", thinking: "", signature: "sig-threading" },
      }],
      providerBlockPositions: [0],
      totalPartCount: 1,
    }],
    resolveModelId: (modelId) => modelId ? `resolved:${modelId}` : undefined,
    resolveModelThinking: (modelId) => modelId ? { enabled: true, budgetTokens: 1234 } : undefined,
    fetchSteering: (input) => {
      fetchInputs.push(input);
      return Promise.resolve({
        instructions: "Project instructions",
        skills: [skill],
      });
    },
    buildInstructions: (input) => [
      {
        role: "system",
        content: [
          input.agentConfig.id,
          input.instructions,
          input.skills.map((entry) => entry.id).join(","),
          input.projectId,
          input.branchId,
          input.environmentContext,
        ].filter((value): value is string => typeof value === "string").join("|"),
      },
    ],
  });

  assertEquals(fetchInputs, [
    {
      projectId: "project-1",
      authToken: "token-1",
      branchId: "branch-1",
    },
  ]);
  assertEquals(result.runtimeConfig.requestedModel, "resolved:requested-model");
  assertEquals(result.creationOptions, {
    projectId: "project-1",
    authToken: "token-1",
    instructions: [
      {
        role: "system",
        content: "agent-1|Project instructions|debug|project-1|branch-1|Browser workspace",
      },
    ],
    branchId: "branch-1",
    model: "resolved:requested-model",
    thinking: { enabled: false },
    maxSteps: 7,
    maxOutputTokens: 1200,
    allowedTools: ["load_skill"],
    allowedProviderTools: [],
    includeRuntimeEssentialToolsWhenEmpty: false,
    allowDelegation: false,
    conversationId: "conversation-1",
    runId: "run-1",
    agentId: "agent-1",
    parentRunId: "run-1",
    parentMessageId: "message-1",
    availableSkillIds: ["debug"],
    skillSelectorPolicy: {
      kind: "all-visible",
      source: "omitted",
    },
    publishParentRunEvents: result.creationOptions.publishParentRunEvents,
    persistToolExposureCheckpoint: result.creationOptions.persistToolExposureCheckpoint,
    requireToolExposureCheckpointPersistence: true,
    clientProfile: null,
    serverResolvedToolExposureCheckpoint: {
      version: 1,
      loadedToolNames: ["get_release"],
    },
    serverResolvedProviderReplayCheckpoints: [{
      version: 1,
      messageId: "assistant-message-1",
      provider: "anthropic",
      providerBlocks: [{
        type: "provider-block",
        provider: "anthropic",
        block: { type: "thinking", thinking: "", signature: "sig-threading" },
      }],
      providerBlockPositions: [0],
      totalPartCount: 1,
    }],
    liveProjectSteering: {
      agent: {
        id: "agent-1",
        model: "configured-model",
        thinking: { enabled: true, budgetTokens: 1000 },
        maxSteps: 50,
        tools: ["get_agent", "load_skill", "update_agent"],
      },
      skillSelectorPolicy: {
        kind: "all-visible",
        source: "omitted",
      },
      environmentContext: "Browser workspace",
      initialProjectInstructions: "Project instructions",
      initialSkills: [skill],
    },
  });
  assertEquals(JSON.stringify(result.creationOptions).includes("root-writer-token"), false);

  await result.creationOptions.publishParentRunEvents?.([{ type: "state_delta" }]);
  assertEquals(parentEvents, [{ type: "state_delta" }]);

  await result.creationOptions.persistToolExposureCheckpoint?.({
    version: 1,
    loadedToolNames: ["get_release"],
  });
  assertEquals(checkpointPersistenceOperations, [
    "append:AGENT_RUN_TOOL_EXPOSURE_CHECKPOINT",
    "flush",
  ]);
  assertEquals(publicCheckpointAppends, 0);

  checkpointFlushComplete = false;
  await assertRejects(
    () =>
      result.creationOptions.persistToolExposureCheckpoint?.({
        version: 1,
        loadedToolNames: ["get_release"],
      }) ?? Promise.resolve(),
    Error,
    "not durably persisted",
  );
  assertEquals(checkpointPersistenceOperations.slice(-3), [
    "append:AGENT_RUN_TOOL_EXPOSURE_CHECKPOINT",
    "flush",
    "dispose",
  ]);
});

Deno.test("prepareHostedChatRuntimeCreationOptions hides deferred skill tools from the first hosted prompt", async () => {
  const result = await prepareHostedChatRuntimeCreationOptions({
    request: createParsedHostedChatRequest(),
    agentConfig: {
      id: "agent-1",
      name: "Agent",
      description: "Hosted agent",
      instructions: "Base instructions",
      tools: true,
      skills: true,
    },
    projectId: "project-1",
    authToken: "token-1",
    resolveModelId: (modelId) => modelId,
    fetchSteering: () =>
      Promise.resolve({
        instructions: "Project instructions",
        skills: [{
          id: "deploy",
          name: "Deploy",
          description: "Deploy the project",
          instructions: "Use bash to deploy.",
          allowedTools: ["bash"],
        }],
      }),
    buildInstructions: buildVeryfrontCloudRuntimeInstructions,
  });

  const instructions = result.creationOptions.instructions;
  const system = Array.isArray(instructions)
    ? instructions.map((message) => message.content).join("\n")
    : instructions;
  assertEquals(system.includes("Deploy the project"), true);
  assertEquals(system.includes("bash"), false);
});

it("prepareHostedChatRuntimeCreationOptions hides skills when load_skill is denied", async () => {
  let visibleToolNames: readonly string[] | undefined;
  const result = await prepareHostedChatRuntimeCreationOptions({
    request: createParsedHostedChatRequest(),
    agentConfig: {
      id: "agent-1",
      name: "Agent",
      description: "Hosted agent",
      instructions: "Base instructions",
      tools: ["get_agent"],
      deniedTools: ["load_skill", "tool_search"],
      skills: true,
    },
    projectId: "project-1",
    authToken: "token-1",
    resolveModelId: (modelId) => modelId,
    fetchSteering: () =>
      Promise.resolve({
        instructions: "Project instructions",
        skills: [{
          id: "deploy",
          name: "Deploy",
          description: "Deploy the project",
          instructions: "Use bash to deploy.",
          allowedTools: ["bash"],
        }],
      }),
    buildInstructions: (input) => {
      visibleToolNames = input.availableToolNames;
      return buildVeryfrontCloudRuntimeInstructions(input);
    },
  });

  const instructions = result.creationOptions.instructions;
  const system = Array.isArray(instructions)
    ? instructions.map((message) => message.content).join("\n")
    : instructions;
  assertEquals(system.includes("<available_skills>"), false);
  assertEquals(system.includes("Deploy the project"), false);
  assertEquals(visibleToolNames?.includes("tool_search") ?? false, false);
});

Deno.test("prepareHostedChatRuntimeCreationOptions uses configured agent tools by default", async () => {
  const result = await prepareHostedChatRuntimeCreationOptions({
    request: createParsedHostedChatRequest(),
    agentConfig: {
      id: "agent-1",
      model: "openai/gpt-5.4-nano",
      tools: ["get_agent", "get_agent_source", "update_agent"],
      providerTools: ["web_search"],
    },
    projectId: "project-1",
    authToken: "token-1",
    resolveModelId: (modelId) => modelId,
    fetchSteering: () => Promise.resolve({ instructions: "", skills: [] }),
    buildInstructions: () => "Agent instructions",
  });

  assertEquals(result.creationOptions.allowedTools, [
    "get_agent",
    "get_agent_source",
    "update_agent",
  ]);
  assertEquals(result.creationOptions.allowedProviderTools, ["web_search"]);
  assertEquals(result.creationOptions.includeRuntimeEssentialToolsWhenEmpty, true);
});

it("private checkpoints fail closed without a trusted run-event append token", async () => {
  let publicMirrorAppends = 0;
  const result = await prepareHostedChatRuntimeCreationOptions({
    request: createParsedHostedChatRequest(),
    agentConfig: {
      id: "agent-1",
      model: "openai/gpt-5.4",
      tools: ["get_release"],
    },
    projectId: "project-1",
    authToken: "user-api-token",
    rootRunContext: {
      durableRootRun: {
        runId: "run-1",
        conversationId: "conversation-1",
        messageId: "message-1",
        latestEventId: 1,
        latestExternalEventSequence: 1,
      },
      durableRunMirror: {
        handleChunk: () => Promise.resolve(),
        appendEvents: () => {
          publicMirrorAppends++;
          return Promise.resolve();
        },
        flush: () =>
          Promise.resolve({
            latestEventId: 1,
            latestExternalEventSequence: 1,
            pendingEventCount: 0,
            consecutiveFailures: 0,
            disabled: false,
            hasFlushTimer: false,
            hasRetryTimer: false,
            inFlight: false,
          }),
        getSnapshot: () => ({
          latestEventId: 1,
          latestExternalEventSequence: 1,
          pendingEventCount: 0,
          consecutiveFailures: 0,
          disabled: false,
          hasFlushTimer: false,
          hasRetryTimer: false,
          inFlight: false,
        }),
        dispose: () => {},
      },
      privateDurableRunMirror: null,
    },
    resolveModelId: (modelId) => modelId,
    fetchSteering: () => Promise.resolve({ instructions: "", skills: [] }),
    buildInstructions: () => "Agent instructions",
  });

  await assertRejects(
    () =>
      result.creationOptions.persistToolExposureCheckpoint?.({
        version: 1,
        loadedToolNames: ["get_release"],
      }) ?? Promise.resolve(),
    Error,
    "trusted run-event append token",
  );
  assertEquals(publicMirrorAppends, 0);
  assertEquals(
    (result.creationOptions as unknown as Record<string, unknown>)
      .requireToolExposureCheckpointPersistence,
    undefined,
  );
});

it("resolves private checkpoint persistence only after the durable flush completes", async () => {
  const operations: string[] = [];
  let resolveFlush: (() => void) | undefined;
  const flushGate = new Promise<void>((resolve) => {
    resolveFlush = resolve;
  });
  const result = await prepareHostedChatRuntimeCreationOptions({
    request: createParsedHostedChatRequest(),
    agentConfig: {
      id: "agent-1",
      model: "openai/gpt-5.4",
      tools: ["get_release"],
    },
    projectId: "project-1",
    authToken: "user-api-token",
    rootRunContext: {
      durableRootRun: {
        runId: "run-1",
        conversationId: "conversation-1",
        messageId: "message-1",
        latestEventId: 1,
        latestExternalEventSequence: 1,
      },
      privateDurableRunMirror: {
        handleChunk: () => Promise.resolve(),
        appendEvents: (events) => {
          operations.push(`append:${events.map((event) => event.type).join(",")}`);
          return Promise.resolve();
        },
        flush: async () => {
          operations.push("flush:start");
          await flushGate;
          operations.push("flush:end");
          return {
            latestEventId: 2,
            latestExternalEventSequence: 2,
            pendingEventCount: 0,
            consecutiveFailures: 0,
            disabled: false,
            hasFlushTimer: false,
            hasRetryTimer: false,
            inFlight: false,
          };
        },
        getSnapshot: () => ({
          latestEventId: 1,
          latestExternalEventSequence: 1,
          pendingEventCount: 0,
          consecutiveFailures: 0,
          disabled: false,
          hasFlushTimer: false,
          hasRetryTimer: false,
          inFlight: false,
        }),
        dispose: () => {},
      },
    },
    resolveModelId: (modelId) => modelId,
    fetchSteering: () => Promise.resolve({ instructions: "", skills: [] }),
    buildInstructions: () => "Agent instructions",
  });

  let resolved = false;
  const persistence = Promise.resolve(
    result.creationOptions.persistToolExposureCheckpoint?.({
      version: 1,
      loadedToolNames: ["get_release"],
    }),
  ).then(() => {
    resolved = true;
  });
  await Promise.resolve();

  assertEquals(operations, [
    "append:AGENT_RUN_TOOL_EXPOSURE_CHECKPOINT",
    "flush:start",
  ]);
  assertEquals(resolved, false);
  resolveFlush?.();
  await persistence;
  assertEquals(operations, [
    "append:AGENT_RUN_TOOL_EXPOSURE_CHECKPOINT",
    "flush:start",
    "flush:end",
  ]);
  assertEquals(resolved, true);
});

Deno.test("prepareHostedChatExecution prepares root run, runtime, and final messages", async () => {
  const result = await prepareHostedChatExecution({
    request: createParsedHostedChatRequest({
      conversationId: "conversation-1",
      projectId: "project-1",
      durableRootRun: {
        runId: "run-1",
        messageId: "message-1",
        latestEventId: 3,
        latestExternalEventSequence: 2,
      },
      parentRunId: "parent-run-1",
    }),
    agentConfig: {
      id: "agent-1",
      model: "configured-model",
      maxSteps: 25,
    },
    apiUrl: "https://api.example.com",
    abortSignal: new AbortController().signal,
    resolveModelId: (modelId) => modelId ? `resolved:${modelId}` : undefined,
    fetchSteering: () =>
      Promise.resolve({
        instructions: "Project instructions",
        skills: [],
      }),
    buildInstructions: (input) => [
      {
        role: "system",
        content: `${input.agentConfig.id}:${input.instructions}`,
      },
    ],
    createRuntime: (options) =>
      Promise.resolve({
        runtimeKind: "framework",
        modelId: options.model ?? "resolved:configured-model",
        cleanup: () => Promise.resolve(),
        agent: {
          stream: () =>
            Promise.resolve({
              steps: Promise.resolve([]),
              toUIMessageStream: async function* () {},
            }),
        },
      }),
  });

  assertEquals(result.parentMessageId, "user-message-1");
  assertEquals(result.rootRunContext.durableRootRun, {
    runId: "run-1",
    conversationId: "conversation-1",
    messageId: "message-1",
    latestEventId: 3,
    latestExternalEventSequence: 2,
  });
  assertEquals(result.rootRunContext.effectiveParentRunId, "run-1");
  assertEquals(result.rootRunContext.effectiveParentMessageId, "message-1");
  assertEquals(result.runtime.runtimeKind, "framework");
  assertEquals(result.runtime.modelId, "resolved:configured-model");
  assertEquals(result.finalMessages.length, 1);
  assertEquals(result.steering.agentInstructions, [
    {
      role: "system",
      content: "agent-1:Project instructions",
    },
  ]);
});

Deno.test("prepareHostedChatRuntimeCreationOptions forwards the verified integration tool grant", async () => {
  const withGrant = await prepareHostedChatRuntimeCreationOptions({
    request: createParsedHostedChatRequest(),
    agentConfig: { id: "agent-1", model: "configured-model" },
    projectId: "project-1",
    authToken: "token-1",
    resolveModelId: (modelId) => modelId,
    fetchSteering: () => Promise.resolve({ instructions: "", skills: [] }),
    buildInstructions: () => "Agent instructions",
    serverResolvedIntegrationToolNames: ["outlook__list_emails"],
  });
  assertEquals(
    withGrant.creationOptions.serverResolvedIntegrationToolNames,
    ["outlook__list_emails"],
    "verified integration grant must reach runtime creation options",
  );

  const withEmptyGrant = await prepareHostedChatRuntimeCreationOptions({
    request: createParsedHostedChatRequest(),
    agentConfig: { id: "agent-1", model: "configured-model" },
    projectId: "project-1",
    authToken: "token-1",
    resolveModelId: (modelId) => modelId,
    fetchSteering: () => Promise.resolve({ instructions: "", skills: [] }),
    buildInstructions: () => "Agent instructions",
    serverResolvedIntegrationToolNames: [],
  });
  assertEquals(
    "serverResolvedIntegrationToolNames" in withEmptyGrant.creationOptions,
    false,
    "an empty grant must not be stamped on runtime creation options",
  );
});

Deno.test("prepareHostedChatExecution forwards the verified integration tool grant to runtime creation", async () => {
  let recordedOptions: { serverResolvedIntegrationToolNames?: readonly string[] } | undefined;

  await prepareHostedChatExecution({
    request: createParsedHostedChatRequest({
      conversationId: "conversation-1",
      projectId: "project-1",
      durableRootRun: {
        runId: "run-1",
        messageId: "message-1",
        latestEventId: 3,
        latestExternalEventSequence: 2,
      },
    }),
    agentConfig: {
      id: "agent-1",
      model: "configured-model",
      maxSteps: 25,
    },
    apiUrl: "https://api.example.com",
    abortSignal: new AbortController().signal,
    resolveModelId: (modelId) => modelId,
    fetchSteering: () => Promise.resolve({ instructions: "Project instructions", skills: [] }),
    buildInstructions: () => "Agent instructions",
    serverResolvedIntegrationToolNames: ["outlook__list_emails"],
    createRuntime: (options) => {
      recordedOptions = options;
      return Promise.resolve({
        runtimeKind: "framework",
        modelId: options.model ?? "configured-model",
        cleanup: () => Promise.resolve(),
        agent: {
          stream: () =>
            Promise.resolve({
              steps: Promise.resolve([]),
              toUIMessageStream: async function* () {},
            }),
        },
      });
    },
  });

  assertEquals(
    recordedOptions?.serverResolvedIntegrationToolNames,
    ["outlook__list_emails"],
    "verified integration grant must reach runtime creation options",
  );
});

Deno.test("prepareHostedChatExecution strips configured provider history selected by a runtime override", async () => {
  const messages: ChatUiMessage[] = [
    {
      id: "user-1",
      role: "user",
      parts: [{ type: "text", text: "Search the web." }],
    },
    {
      id: "assistant-1",
      role: "assistant",
      parts: [
        {
          type: "dynamic-tool",
          toolName: "web_search",
          toolCallId: "toolu_web_search",
          input: { query: "Veryfront" },
          state: "output-available",
          providerExecuted: true,
          output: null,
        },
        { type: "text", text: "I found the official site." },
      ],
    },
    {
      id: "tool-1",
      role: "tool",
      parts: [{
        type: "tool-web_search",
        toolCallId: "toolu_web_search",
        toolName: "web_search",
        input: { query: "Veryfront" },
        state: "output-available",
        output: null,
      }],
    },
    {
      id: "user-2",
      role: "user",
      parts: [{ type: "text", text: "Continue." }],
    },
  ];

  const result = await prepareHostedChatExecution({
    request: createParsedHostedChatRequest({
      messages,
      model: "anthropic/claude-sonnet-4-6",
      runtimeOverrides: { allowedTools: ["web_search"] },
      durableRootRun: {
        runId: "run-1",
        messageId: "message-1",
        latestEventId: 3,
        latestExternalEventSequence: 2,
      },
    }),
    agentConfig: {
      id: "agent-1",
      model: "anthropic/claude-sonnet-4-6",
      providerTools: ["web_search"],
    },
    apiUrl: "https://api.example.com",
    abortSignal: new AbortController().signal,
    resolveModelId: (modelId) => modelId,
    fetchSteering: () => Promise.resolve({ instructions: "", skills: [] }),
    buildInstructions: () => "Agent instructions",
    createRuntime: (options) =>
      Promise.resolve({
        runtimeKind: "framework",
        modelId: options.model ?? "anthropic/claude-sonnet-4-6",
        cleanup: () => Promise.resolve(),
        agent: {
          stream: () =>
            Promise.resolve({
              steps: Promise.resolve([]),
              toUIMessageStream: async function* () {},
            }),
        },
      }),
  });

  assertEquals(result.finalMessages.map((message) => message.role), [
    "user",
    "assistant",
    "user",
  ]);
  assertEquals(result.finalMessages[1]?.parts, [{
    type: "text",
    text: "I found the official site.",
  }]);
});

Deno.test(
  "prepareHostedChatExecution preserves provider history anchored by a server-resolved replay checkpoint",
  async () => {
    const messages: ChatUiMessage[] = [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Search the web." }],
      },
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          {
            type: "dynamic-tool",
            toolName: "web_search",
            toolCallId: "toolu_web_search",
            input: { query: "Veryfront" },
            state: "output-available",
            providerExecuted: true,
            output: null,
          },
          { type: "text", text: "I found the official site." },
        ],
      },
      {
        id: "user-2",
        role: "user",
        parts: [{ type: "text", text: "Continue." }],
      },
    ];

    const result = await prepareHostedChatExecution({
      request: createParsedHostedChatRequest({
        messages,
        model: "anthropic/claude-sonnet-4-6",
        runtimeOverrides: { allowedTools: ["web_search"] },
        durableRootRun: {
          runId: "run-1",
          messageId: "message-1",
          latestEventId: 3,
          latestExternalEventSequence: 2,
        },
      }),
      agentConfig: {
        id: "agent-1",
        model: "anthropic/claude-sonnet-4-6",
        providerTools: ["web_search"],
      },
      apiUrl: "https://api.example.com",
      abortSignal: new AbortController().signal,
      serverResolvedProviderReplayCheckpoints: [{
        version: 1,
        messageId: "assistant-1",
        provider: "anthropic",
        providerBlocks: [{
          type: "provider-block",
          provider: "anthropic",
          block: {
            type: "server_tool_use",
            id: "toolu_web_search",
            name: "web_search",
            input: { query: "Veryfront" },
          },
        }],
        providerBlockPositions: [0],
        totalPartCount: 2,
      }],
      resolveModelId: (modelId) => modelId,
      fetchSteering: () => Promise.resolve({ instructions: "", skills: [] }),
      buildInstructions: () => "Agent instructions",
      createRuntime: (options) =>
        Promise.resolve({
          runtimeKind: "framework",
          modelId: options.model ?? "anthropic/claude-sonnet-4-6",
          cleanup: () => Promise.resolve(),
          agent: {
            stream: () =>
              Promise.resolve({
                steps: Promise.resolve([]),
                toUIMessageStream: async function* () {},
              }),
          },
        }),
    });

    const checkpointedParts = result.finalMessages
      .filter((message) => message.id === "assistant-1")
      .flatMap((message) => message.parts);
    assertEquals(
      checkpointedParts.flatMap((part) =>
        "toolCallId" in part && part.toolCallId === "toolu_web_search" ? [part.type] : []
      ),
      ["tool-call", "tool-result"],
      "checkpointed provider call and result survive the production preparation entry point",
    );
  },
);

Deno.test("prepareHostedChatExecution does not carry old submitted form input into a new user turn", async () => {
  const messages: ChatUiMessage[] = [
    {
      id: "user-old",
      role: "user",
      parts: [{ type: "text", text: "Help me build an agent" }],
    },
    {
      id: "assistant-old",
      role: "assistant",
      parts: [{
        type: "dynamic-tool",
        toolCallId: "old-form-call",
        toolName: "form_input",
        state: "output-available",
        input: { title: "Create Agent" },
        output: {
          submitted: true,
          values: { brief: "old gmail agent" },
          inputRequestId: "old-input-request",
        },
      }],
    },
    {
      id: "user-new",
      role: "user",
      parts: [{ type: "text", text: "Now help me plan something else" }],
    },
  ];
  let runtimeOptions:
    | { submittedFormInputResult?: unknown }
    | undefined;

  await prepareHostedChatExecution({
    request: createParsedHostedChatRequest({
      messages,
      conversationId: "conversation-1",
      projectId: "project-1",
      durableRootRun: {
        runId: "run-new",
        messageId: "message-new",
        latestEventId: 3,
        latestExternalEventSequence: 2,
      },
    }),
    agentConfig: {
      id: "agent-1",
      model: "configured-model",
      maxSteps: 25,
    },
    apiUrl: "https://api.example.com",
    abortSignal: new AbortController().signal,
    resolveModelId: (modelId) => modelId ? `resolved:${modelId}` : undefined,
    fetchSteering: () =>
      Promise.resolve({
        instructions: "Project instructions",
        skills: [],
      }),
    buildInstructions: (input) => [
      {
        role: "system",
        content: `${input.agentConfig.id}:${input.instructions}`,
      },
    ],
    createRuntime: (options) => {
      runtimeOptions = options;
      return Promise.resolve({
        runtimeKind: "framework",
        modelId: options.model ?? "resolved:configured-model",
        cleanup: () => Promise.resolve(),
        agent: {
          stream: () =>
            Promise.resolve({
              steps: Promise.resolve([]),
              toUIMessageStream: async function* () {},
            }),
        },
      });
    },
  });

  assertEquals(runtimeOptions?.submittedFormInputResult, undefined);
});

Deno.test("prepareHostedChatExecution preserves allowed remote tool history", async () => {
  const messages: ChatUiMessage[] = [
    {
      id: "user-1",
      role: "user",
      parts: [{ type: "text", text: "Check my Harvest account." }],
    },
    {
      id: "assistant-1",
      role: "assistant",
      parts: [
        {
          type: "dynamic-tool",
          toolName: "harvest__list_accounts",
          toolCallId: "toolu_harvest_accounts",
          input: {},
          state: "output-available",
          output: {
            accounts: [{ id: "acct-1", name: "Test Account", product: "harvest" }],
            summary: { count: 1 },
          },
        },
      ],
    },
    {
      id: "tool-1",
      role: "tool",
      parts: [
        {
          type: "tool-harvest__list_accounts",
          toolCallId: "toolu_harvest_accounts",
          toolName: "harvest__list_accounts",
          input: {},
          state: "output-available",
          output: {
            accounts: [{ id: "acct-1", name: "Test Account", product: "harvest" }],
            summary: { count: 1 },
          },
        },
      ],
    },
    {
      id: "user-2",
      role: "user",
      parts: [{ type: "text", text: "Use that account." }],
    },
  ];

  const result = await prepareHostedChatExecution({
    request: createParsedHostedChatRequest({
      messages,
      conversationId: "conversation-1",
      projectId: "project-1",
      durableRootRun: {
        runId: "run-1",
        messageId: "message-1",
        latestEventId: 3,
        latestExternalEventSequence: 2,
      },
    }),
    agentConfig: {
      id: "agent-1",
      model: "configured-model",
      allowedRemoteTools: ["harvest__list_accounts"],
    },
    apiUrl: "https://api.example.com",
    abortSignal: new AbortController().signal,
    resolveModelId: (modelId) => modelId,
    fetchSteering: () =>
      Promise.resolve({
        instructions: "Project instructions",
        skills: [],
      }),
    buildInstructions: (input) => input.instructions,
    createRuntime: (options) =>
      Promise.resolve({
        runtimeKind: "framework",
        modelId: options.model ?? "configured-model",
        cleanup: () => Promise.resolve(),
        agent: {
          stream: () =>
            Promise.resolve({
              steps: Promise.resolve([]),
              toUIMessageStream: async function* () {},
            }),
        },
      }),
  });

  assertEquals(
    result.finalMessages.some((message) =>
      message.parts.some((part) =>
        part.type === "tool-result" &&
        part.toolName === "harvest__list_accounts" &&
        "result" in part &&
        typeof part.result === "object" &&
        part.result !== null &&
        "type" in part.result &&
        part.result.type === "json" &&
        "value" in part.result &&
        typeof part.result.value === "object" &&
        part.result.value !== null &&
        "accounts" in part.result.value
      )
    ),
    true,
  );
});

Deno.test("prepareHostedChatExecution compacts oversized context and appends a durable event", async () => {
  const originalFetch = globalThis.fetch;
  const appendedBodies: unknown[] = [];
  globalThis.fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (input.toString().endsWith("/events")) {
      appendedBodies.push(JSON.parse(String(observeFetchRequestInit(init).body ?? "{}")));
      return Promise.resolve(
        new Response(
          JSON.stringify({
            latest_event_id: 4,
            latest_external_event_sequence: 3,
            appended_count: 1,
            run: {
              run_id: "run-1",
              conversation_id: "11111111-1111-4111-a111-111111111111",
              latest_event_id: 4,
              latest_external_event_sequence: 3,
            },
          }),
          { status: 200 },
        ),
      );
    }

    return Promise.resolve(new Response("{}", { status: 404 }));
  };

  try {
    const result = await prepareHostedChatExecution({
      request: createParsedHostedChatRequest({
        runEventAppendToken: "run-event-service-token",
        conversationId: "11111111-1111-4111-a111-111111111111",
        projectId: "project-1",
        validatedContext: {
          conversationId: "11111111-1111-4111-a111-111111111111",
          projectId: "project-1",
          branchId: "branch-1",
        },
        messages: [
          {
            id: "user-old",
            role: "user",
            parts: [{ type: "text", text: "Older request ".repeat(200) }],
          },
          {
            id: "assistant-old",
            role: "assistant",
            parts: [{ type: "text", text: "Recent answer." }],
          },
          {
            id: "user-latest",
            role: "user",
            parts: [{ type: "text", text: "Continue from the latest requirement." }],
          },
        ],
        durableRootRun: {
          runId: "run-1",
          messageId: "message-1",
          latestEventId: 3,
          latestExternalEventSequence: 2,
        },
      }),
      agentConfig: {
        id: "agent-1",
        model: "configured-model",
        maxSteps: 25,
      },
      apiUrl: "https://api.example.com",
      abortSignal: new AbortController().signal,
      resolveModelId: (modelId) => modelId ? `resolved:${modelId}` : undefined,
      fetchSteering: () =>
        Promise.resolve({
          instructions: "Project instructions",
          skills: [],
        }),
      buildInstructions: (input) => [
        {
          role: "system",
          content: `${input.agentConfig.id}:${input.instructions}`,
        },
      ],
      createRuntime: (options) => {
        assertEquals("runEventAppendToken" in options, false);
        assertEquals("runEventWriterCapability" in options, false);
        assertEquals(JSON.stringify(options).includes("run-event-service-token"), false);
        return Promise.resolve({
          runtimeKind: "framework",
          modelId: options.model ?? "resolved:configured-model",
          cleanup: () => Promise.resolve(),
          agent: {
            stream: () =>
              Promise.resolve({
                steps: Promise.resolve([]),
                toUIMessageStream: async function* () {},
              }),
          },
        });
      },
      contextBudget: {
        tokenBudget: 220,
        reserveTokens: 20,
        recentTailTokens: 20,
        now: () => 123,
        summaryGenerator: () => ({ text: "Older context summarized." }),
      },
    });

    assertEquals(result.contextBudgetDiagnostics?.compacted, true);
    assertEquals(result.finalMessages.map((message) => message.id), [
      "context_compaction_summary:assistant-old",
      "assistant-old",
      "user-latest",
    ]);
    assertEquals(appendedBodies.length, 1);
    assertEquals(
      (appendedBodies[0] as { events?: Array<{ type?: string }> }).events?.[0]?.type,
      "AGENT_RUN_CONTEXT_COMPACTED",
    );
    assertEquals(
      (appendedBodies[0] as { events?: Array<{ firstKeptEntryId?: string }> }).events?.[0]
        ?.firstKeptEntryId,
      "assistant-old",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("prepareHostedChatExecution rejects compacted context when durable event persistence is not complete", async () => {
  const originalFetch = globalThis.fetch;
  let createRuntimeCalls = 0;
  globalThis.fetch = (input): Promise<Response> => {
    if (input.toString().endsWith("/events")) {
      return Promise.resolve(
        new Response(JSON.stringify({ detail: "append failed" }), {
          status: 500,
        }),
      );
    }

    return Promise.resolve(new Response("{}", { status: 404 }));
  };

  try {
    await assertRejects(
      () =>
        prepareHostedChatExecution({
          request: createParsedHostedChatRequest({
            runEventAppendToken: "run-event-service-token",
            conversationId: "11111111-1111-4111-a111-111111111111",
            projectId: "project-1",
            validatedContext: {
              conversationId: "11111111-1111-4111-a111-111111111111",
              projectId: "project-1",
              branchId: "branch-1",
            },
            messages: [
              {
                id: "user-old",
                role: "user",
                parts: [{ type: "text", text: "Older request ".repeat(200) }],
              },
              {
                id: "user-latest",
                role: "user",
                parts: [{ type: "text", text: "Continue from the latest requirement." }],
              },
            ],
            durableRootRun: {
              runId: "run-1",
              messageId: "message-1",
              latestEventId: 3,
              latestExternalEventSequence: 2,
            },
          }),
          agentConfig: {
            id: "agent-1",
            model: "configured-model",
            maxSteps: 25,
          },
          apiUrl: "https://api.example.com",
          abortSignal: new AbortController().signal,
          resolveModelId: (modelId) => modelId ? `resolved:${modelId}` : undefined,
          fetchSteering: () =>
            Promise.resolve({
              instructions: "Project instructions",
              skills: [],
            }),
          buildInstructions: (input) => [
            {
              role: "system",
              content: `${input.agentConfig.id}:${input.instructions}`,
            },
          ],
          createRuntime: (options) => {
            createRuntimeCalls += 1;
            return Promise.resolve({
              runtimeKind: "framework",
              modelId: options.model ?? "resolved:configured-model",
              cleanup: () => Promise.resolve(),
              agent: {
                stream: () =>
                  Promise.resolve({
                    steps: Promise.resolve([]),
                    toUIMessageStream: async function* () {},
                  }),
              },
            });
          },
          contextBudget: {
            tokenBudget: 220,
            reserveTokens: 20,
            recentTailTokens: 20,
            summaryGenerator: () => ({ text: "Older context summarized." }),
          },
        }),
      ContextCompactionError,
      "Context compaction event was not durably persisted before model execution",
    );
    assertEquals(createRuntimeCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("prepareHostedChatRuntimeMessages refreshes uploaded file URLs through the hosted API", async () => {
  const requestedUrls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, _init): Promise<Response> => {
    const url = input.toString();
    requestedUrls.push(url);
    if (url === "https://signed.example.com/notes.txt") {
      return Promise.resolve(new Response("Remember Order #4587.", { status: 200 }));
    }

    return Promise.resolve(
      new Response(JSON.stringify({ signed_url: "https://signed.example.com/notes.txt" }), {
        status: 200,
      }),
    );
  };

  try {
    const messages = await prepareHostedChatRuntimeMessages([
      {
        id: "message-1",
        role: "user",
        parts: [
          { type: "text", text: "Use this file." },
          {
            type: "file",
            mediaType: "text/plain",
            filename: "notes.txt",
            uploadId: "upload-1",
            url: "https://files.example.com/original.txt",
          },
        ],
      },
    ], {
      apiUrl: "https://api.example.com",
      authToken: "token-1",
      projectId: "project-1",
    });

    assertEquals(requestedUrls, [
      "https://api.example.com/projects/project-1/uploads/upload-1/url",
      "https://signed.example.com/notes.txt",
    ]);
    assertEquals(
      messages[0]?.parts.some((part) =>
        isRuntimeFilePart(part) &&
        part.url === "https://signed.example.com/notes.txt" &&
        part.mediaType === "text/plain"
      ),
      true,
    );
    assertEquals(
      messages[0]?.parts.some((part) =>
        isRuntimeTextPart(part) &&
        part.text.includes('<file_content name="notes.txt" type="text/plain">') &&
        part.text.includes("Remember Order #4587.")
      ),
      true,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("prepareHostedChatExecution aborts stalled signed attachment fetch before runtime creation", async () => {
  const originalFetch = globalThis.fetch;
  const abortController = new AbortController();
  let resolveSignedFetchStarted: (() => void) | undefined;
  const signedFetchStarted = new Promise<void>((resolve) => {
    resolveSignedFetchStarted = resolve;
  });
  let createRuntimeCalls = 0;
  let cancelStartGuard = () => {};
  let cancelPreparationGuard = () => {};

  globalThis.fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = input.toString();
    if (url === "https://api.example.com/projects/project-1/uploads/upload-1/url") {
      return Promise.resolve(
        new Response(JSON.stringify({ signed_url: "https://signed.example.com/notes.txt" }), {
          status: 200,
        }),
      );
    }
    if (url === "https://signed.example.com/notes.txt") {
      resolveSignedFetchStarted?.();
      return pendingResponseUntilAbort(observeFetchRequestInit(init).signal);
    }

    return Promise.reject(new Error(`unexpected fetch ${url}`));
  };

  try {
    const preparation = prepareHostedChatExecution({
      request: createParsedHostedChatRequest({
        conversationId: "conversation-1",
        projectId: "project-1",
        durableRootRun: {
          runId: "run-1",
          messageId: "message-1",
          latestEventId: 3,
          latestExternalEventSequence: 2,
        },
        messages: [{
          id: "message-1",
          role: "user",
          parts: [
            { type: "text", text: "Use this file." },
            {
              type: "file",
              mediaType: "text/plain",
              filename: "notes.txt",
              uploadId: "upload-1",
              url: "https://files.example.com/original.txt",
            },
          ],
        }],
      }),
      agentConfig: {
        id: "agent-1",
        model: "configured-model",
      },
      apiUrl: "https://api.example.com",
      abortSignal: abortController.signal,
      resolveModelId: (modelId) => modelId ? `resolved:${modelId}` : undefined,
      fetchSteering: () =>
        Promise.resolve({
          instructions: "Project instructions",
          skills: [],
        }),
      buildInstructions: (input) => [
        {
          role: "system",
          content: `${input.agentConfig.id}:${input.instructions}`,
        },
      ],
      createRuntime: (options) => {
        createRuntimeCalls++;
        return Promise.resolve({
          runtimeKind: "framework",
          modelId: options.model ?? "resolved:configured-model",
          cleanup: () => Promise.resolve(),
          agent: {
            stream: () =>
              Promise.resolve({
                steps: Promise.resolve([]),
                toUIMessageStream: async function* () {},
              }),
          },
        });
      },
    });

    const startGuard = rejectIfStillPending(
      signedFetchStarted,
      50,
      "signed content fetch was not started",
    );
    cancelStartGuard = startGuard.cancel;
    await startGuard.promise;

    const preparationGuard = rejectIfStillPending(
      preparation,
      50,
      "hosted execution still pending after abort",
    );
    cancelPreparationGuard = preparationGuard.cancel;
    abortController.abort(new Error("caller aborted"));

    await assertRejects(
      () => preparationGuard.promise,
      Error,
      "Failed to fetch text attachment content for notes.txt: request aborted",
    );
    assertEquals(createRuntimeCalls, 0);
  } finally {
    cancelStartGuard();
    cancelPreparationGuard();
    globalThis.fetch = originalFetch;
  }
});

Deno.test("prepareHostedChatRuntimeMessages does not fetch caller-controlled file URLs", async () => {
  const requestedUrls: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, _init): Promise<Response> => {
    requestedUrls.push(input.toString());
    return Promise.reject(new Error("unexpected hosted attachment fetch"));
  };

  try {
    const messages = await prepareHostedChatRuntimeMessages([
      {
        id: "message-1",
        role: "user",
        parts: [
          { type: "text", text: "Use this file." },
          {
            type: "file",
            mediaType: "text/plain",
            filename: "notes.txt",
            url: "http://127.0.0.1:9876/internal-notes.txt",
          },
        ],
      },
    ], {
      apiUrl: "https://api.example.com",
      authToken: "token-1",
      projectId: "project-1",
    });

    assertEquals(requestedUrls, []);
    assertEquals(
      messages[0]?.parts.some((part) =>
        isRuntimeTextPart(part) && part.text.includes("<file_content")
      ),
      false,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("prepareHostedChatRuntimeMessages omits provider-owned remote tool history", async () => {
  const messages = await prepareHostedChatRuntimeMessages(
    [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Explain Swedish tax residency." }],
      },
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          {
            type: "dynamic-tool",
            toolName: "web_search",
            toolCallId: "toolu_web_search",
            input: { query: "site:skatteverket.se tax residency" },
            state: "output-available",
            providerExecuted: true,
            output: null,
          },
          {
            type: "text",
            text: "Unlimited tax liability is based on Chapter 3 of the Income Tax Act.",
          },
        ],
      },
      {
        id: "tool-1",
        role: "tool",
        parts: [
          {
            type: "tool-web_search",
            toolCallId: "toolu_web_search",
            toolName: "web_search",
            input: { query: "site:skatteverket.se tax residency" },
            state: "output-available",
            output: null,
          },
        ],
      },
      {
        id: "user-2",
        role: "user",
        parts: [{ type: "text", text: "Cite the official source." }],
      },
    ],
    {
      providerOwnedToolNames: ["web_search"],
    },
  );

  assertEquals(messages.map((message) => message.role), ["user", "assistant", "user"]);
  assertEquals(messages[1]?.parts, [{
    type: "text",
    text: "Unlimited tax liability is based on Chapter 3 of the Income Tax Act.",
  }]);
});

Deno.test(
  "prepareHostedChatRuntimeMessages preserves checkpoint-anchored provider tool history",
  async () => {
    const messages = await prepareHostedChatRuntimeMessages(
      [
        {
          id: "user-1",
          role: "user",
          parts: [{ type: "text", text: "Search the official documentation." }],
        },
        {
          id: "assistant-1",
          role: "assistant",
          parts: [{
            type: "dynamic-tool",
            toolName: "web_search",
            toolCallId: "srvtool-web-search",
            input: { query: "site:veryfront.com provider replay" },
            state: "output-available",
            providerExecuted: true,
            output: [],
          }],
        },
        {
          id: "user-2",
          role: "user",
          parts: [{ type: "text", text: "Summarize the result." }],
        },
      ],
      {
        providerOwnedToolNames: ["web_search"],
        providerReplayCheckpointMessageIds: ["assistant-1"],
      },
    );

    const checkpointedParts = messages
      .filter((message) => message.id === "assistant-1")
      .flatMap((message) => message.parts);
    assertEquals(
      checkpointedParts,
      [
        {
          type: "tool-call",
          toolCallId: "srvtool-web-search",
          toolName: "web_search",
          args: { query: "site:veryfront.com provider replay" },
          providerExecuted: true,
        },
        {
          type: "tool-result",
          toolCallId: "srvtool-web-search",
          toolName: "web_search",
          result: {
            type: "json",
            value: [],
          },
          providerExecuted: true,
        },
      ],
      "checkpointed provider call and result remain available for replay validation",
    );
  },
);

Deno.test("prepareHostedChatRuntimeMessages preserves opaque-only checkpoint anchors", async () => {
  const messages = await prepareHostedChatRuntimeMessages(
    [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Think privately." }],
      },
      {
        id: "assistant-empty",
        role: "assistant",
        parts: [],
      },
      {
        id: "user-2",
        role: "user",
        parts: [{ type: "text", text: "Continue." }],
      },
    ],
    {
      providerReplayCheckpointMessageIds: ["assistant-empty"],
    },
  );

  assertEquals(
    messages.find((message) => message.id === "assistant-empty"),
    {
      id: "assistant-empty",
      role: "assistant",
      parts: [],
      timestamp: 1,
    },
    "opaque-only replay anchors must survive even when they have no public parts",
  );
});

Deno.test("prepareHostedChatRuntimeMessages reports historical tool input compaction diagnostics", async () => {
  const diagnostics: HistoricalToolInputCompactionDiagnostic[] = [];
  const marker = "HOSTED_TOOL_INPUT_MARKER";
  const messages = await prepareHostedChatRuntimeMessages(
    [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Render the widget." }],
      },
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{
          type: "dynamic-tool",
          toolName: "render_widget",
          toolCallId: "tool-render-widget",
          input: {
            targetPath: "components/Widget.tsx",
            source: `${marker}:${"export const widget = true;\n".repeat(2000)}`,
          },
          state: "output-available",
          output: { ok: true },
        }],
      },
      {
        id: "user-2",
        role: "user",
        parts: [{ type: "text", text: "Update the widget." }],
      },
    ],
    {
      historicalToolInputRetention: {
        diagnostics,
        resolvePolicy: (toolName) =>
          toolName === "render_widget"
            ? {
              compactCompletedInput: true,
              compactAfterChars: 100,
              retainInputFields: [{ inputName: "targetPath", outputName: "path" }],
            }
            : undefined,
      },
    },
  );

  const serialized = JSON.stringify(messages);
  assertEquals(serialized.includes(marker), false);
  assertEquals(diagnostics.length, 1);
  assertEquals((diagnostics[0] as { source?: string }).source, "provider");
  assertEquals((diagnostics[0] as { toolName?: string }).toolName, "render_widget");
  assertEquals((diagnostics[0] as { toolCallId?: string }).toolCallId, "tool-render-widget");
});

Deno.test("prepareHostedChatRuntimeMessages preserves checkpointed historical tool inputs", async () => {
  const diagnostics: HistoricalToolInputCompactionDiagnostic[] = [];
  const marker = "CHECKPOINTED_TOOL_INPUT_MARKER";
  const messages = await prepareHostedChatRuntimeMessages(
    [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Render the widget." }],
      },
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{
          type: "dynamic-tool",
          toolName: "render_widget",
          toolCallId: "tool-render-widget",
          input: {
            targetPath: "components/Widget.tsx",
            source: `${marker}:${"export const widget = true;\n".repeat(2000)}`,
          },
          state: "output-available",
          output: { ok: true },
        }],
      },
      {
        id: "user-2",
        role: "user",
        parts: [{ type: "text", text: "Update the widget." }],
      },
    ],
    {
      providerReplayCheckpointMessageIds: ["assistant-1"],
      historicalToolInputRetention: {
        diagnostics,
        resolvePolicy: (toolName) =>
          toolName === "render_widget"
            ? {
              compactCompletedInput: true,
              compactAfterChars: 100,
            }
            : undefined,
      },
    },
  );

  const serialized = JSON.stringify(messages);
  assertEquals(serialized.includes(marker), true);
  assertEquals(diagnostics, []);
});

Deno.test("prepareHostedChatRuntimeMessages merges checkpoint and caller-preserved source ids", async () => {
  const diagnostics: HistoricalToolInputCompactionDiagnostic[] = [];
  const checkpointMarker = "CHECKPOINT_RETENTION_MARKER";
  const callerMarker = "CALLER_RETENTION_MARKER";
  const messages = await prepareHostedChatRuntimeMessages(
    [
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "Render both widgets." }],
      },
      {
        id: "assistant-checkpoint",
        role: "assistant",
        parts: [{
          type: "dynamic-tool",
          toolName: "render_widget",
          toolCallId: "tool-render-checkpoint",
          input: {
            source: `${checkpointMarker}:${"checkpoint body ".repeat(500)}`,
          },
          state: "output-available",
          output: { ok: true },
        }],
      },
      {
        id: "assistant-caller",
        role: "assistant",
        parts: [{
          type: "dynamic-tool",
          toolName: "render_widget",
          toolCallId: "tool-render-caller",
          input: {
            source: `${callerMarker}:${"caller body ".repeat(500)}`,
          },
          state: "output-available",
          output: { ok: true },
        }],
      },
      {
        id: "user-2",
        role: "user",
        parts: [{ type: "text", text: "Update both widgets." }],
      },
    ],
    {
      providerReplayCheckpointMessageIds: ["assistant-checkpoint"],
      historicalToolInputRetention: {
        diagnostics,
        preserveSourceMessageIds: ["assistant-caller"],
        resolvePolicy: (toolName) =>
          toolName === "render_widget"
            ? {
              compactCompletedInput: true,
              compactAfterChars: 100,
            }
            : undefined,
      },
    },
  );

  const serialized = JSON.stringify(messages);
  assertEquals(serialized.includes(checkpointMarker), true);
  assertEquals(serialized.includes(callerMarker), true);
  assertEquals(diagnostics, []);
});

Deno.test("prepareHostedChatRuntimeCreationOptions applies the skill selector and owner scope", async () => {
  const skills = [
    {
      id: "global-howto",
      name: "Global Howto",
      description: "Project-global guide",
      instructions: "Follow the guide.",
      allowedTools: [],
    },
    {
      id: "researcher--cite",
      name: "cite",
      description: "Cite sources",
      instructions: "Cite primary sources.",
      allowedTools: [],
      ownerAgentId: "researcher",
      shortName: "cite",
      sourcePath: "agents/researcher/skills/cite/SKILL.md",
    },
    {
      id: "writer--style",
      name: "style",
      description: "House style",
      instructions: "Use the house style.",
      allowedTools: [],
      ownerAgentId: "writer",
      shortName: "style",
    },
  ];
  const seenByInstructions: string[][] = [];

  const result = await prepareHostedChatRuntimeCreationOptions({
    request: createParsedHostedChatRequest({}),
    agentConfig: { id: "researcher", model: "configured-model", skills: ["cite"] },
    projectId: "project-1",
    authToken: "token-1",
    resolveModelId: (modelId) => modelId,
    resolveModelThinking: () => undefined,
    fetchSteering: () =>
      Promise.resolve({
        instructions: "Project instructions",
        skills,
      }),
    buildInstructions: (input) => {
      seenByInstructions.push(input.skills.map((entry) => entry.id));
      return [{ role: "system", content: "x" }];
    },
  });

  const advertised = ["researcher--cite"];
  assertEquals(seenByInstructions, [advertised]);
  assertEquals(result.creationOptions.availableSkillIds, advertised);
  assertEquals(result.creationOptions.skillSelectorPolicy, {
    kind: "allowlist",
    entries: ["cite"],
  });
  assertEquals(result.creationOptions.skillSourcePaths, {
    "researcher--cite": "agents/researcher/skills/cite/SKILL.md",
  });
  assertEquals(
    (result.creationOptions.liveProjectSteering?.initialSkills ?? []).map((
      skill: { id: string },
    ) => skill.id),
    advertised,
  );
  assertEquals(result.steering.skills.map((skill) => skill.id), advertised);
});

Deno.test("prepareHostedChatRuntimeCreationOptions uses the exact selector snapshot for an empty selector", async () => {
  const result = await prepareHostedChatRuntimeCreationOptions({
    request: createParsedHostedChatRequest({}),
    agentConfig: { id: "researcher", model: "configured-model", skills: [] },
    projectId: "project-1",
    authToken: "token-1",
    resolveModelId: (modelId) => modelId,
    resolveModelThinking: () => undefined,
    fetchSteering: () =>
      Promise.resolve({
        instructions: "Project instructions",
        skills: [{
          id: "global-howto",
          name: "Global Howto",
          description: "Project-global guide",
          instructions: "Follow the guide.",
          allowedTools: [],
        }],
      }),
    buildInstructions: (input) => [{ role: "system", content: `${input.skills.length}` }],
  });

  assertEquals(result.creationOptions.availableSkillIds, []);
  assertEquals(result.creationOptions.skillSelectorPolicy, { kind: "none" });
  assertEquals(result.creationOptions.instructions, [{ role: "system", content: "0" }]);
  assertEquals(result.steering.skills, []);
});
