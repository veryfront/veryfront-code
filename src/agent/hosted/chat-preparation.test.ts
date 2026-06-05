import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import type { ChatUiMessage } from "#veryfront/chat/types.ts";
import type { ParsedHostedChatRequest } from "./chat-request-parser.ts";
import { ContextCompactionError } from "./context-budget-manager.ts";
import {
  normalizeParsedHostedChatRequest,
  prepareHostedChatExecution,
  prepareHostedChatRuntimeCreationOptions,
  prepareHostedChatRuntimeMessages,
} from "./chat-preparation.ts";

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

function createParsedHostedChatRequest(
  overrides: Partial<ParsedHostedChatRequest> = {},
): ParsedHostedChatRequest {
  return {
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
    ...overrides,
  };
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

  const result = await prepareHostedChatRuntimeCreationOptions({
    request: createParsedHostedChatRequest({
      allowDelegation: false,
      model: "requested-model",
      runtimeOverrides: {
        allowedTools: ["load_skill"],
        thinking: false,
        maxSteps: 7,
      },
    }),
    agentConfig: {
      id: "agent-1",
      model: "configured-model",
      thinking: { enabled: true, budgetTokens: 1000 },
      maxSteps: 50,
    },
    projectId: "project-1",
    authToken: "token-1",
    conversationId: "conversation-1",
    branchId: "branch-1",
    environmentContext: "Browser workspace",
    rootRunContext: {
      effectiveParentRunId: "run-1",
      effectiveParentMessageId: "message-1",
      publishParentRunEvents: (events) => {
        parentEvents.push(...events);
        return Promise.resolve();
      },
    },
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
    allowedTools: ["load_skill"],
    allowDelegation: false,
    conversationId: "conversation-1",
    parentRunId: "run-1",
    parentMessageId: "message-1",
    availableSkillIds: ["debug"],
    publishParentRunEvents: result.creationOptions.publishParentRunEvents,
    clientProfile: null,
    liveProjectSteering: {
      agent: {
        id: "agent-1",
        model: "configured-model",
        thinking: { enabled: true, budgetTokens: 1000 },
        maxSteps: 50,
      },
      environmentContext: "Browser workspace",
      initialProjectInstructions: "Project instructions",
      initialSkills: [skill],
    },
  });

  await result.creationOptions.publishParentRunEvents?.([{ type: "state_delta" }]);
  assertEquals(parentEvents, [{ type: "state_delta" }]);
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

Deno.test("prepareHostedChatExecution compacts oversized context and appends a durable event", async () => {
  const originalFetch = globalThis.fetch;
  const appendedBodies: unknown[] = [];
  globalThis.fetch = (input, init): Promise<Response> => {
    if (input.toString().endsWith("/events")) {
      appendedBodies.push(JSON.parse(String(init?.body ?? "{}")));
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
    requestedUrls.push(input.toString());
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
    ]);
    assertEquals(
      messages[0]?.parts.some((part) =>
        isRuntimeFilePart(part) &&
        part.url === "https://signed.example.com/notes.txt" &&
        part.mediaType === "text/plain"
      ),
      true,
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
