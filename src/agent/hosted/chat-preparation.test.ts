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
    runId: "run-1",
    agentId: "agent-1",
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

  globalThis.fetch = (input, init): Promise<Response> => {
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
      return pendingResponseUntilAbort(init?.signal);
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

Deno.test("prepareHostedChatRuntimeMessages reports historical tool input compaction diagnostics", async () => {
  const diagnostics: unknown[] = [];
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

Deno.test("prepareHostedChatRuntimeCreationOptions filters skills to the run agent's owner scope", async () => {
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
    agentConfig: { id: "researcher", model: "configured-model" },
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

  const expected = ["global-howto", "researcher--cite"];
  // Prompt-manifest input, per-run load_skill gate, live steering payload, and
  // the returned steering all carry the same owner-scoped set.
  assertEquals(seenByInstructions, [expected]);
  assertEquals(result.creationOptions.availableSkillIds, expected);
  assertEquals(result.creationOptions.skillSourcePaths, {
    "researcher--cite": "agents/researcher/skills/cite/SKILL.md",
  });
  assertEquals(
    (result.creationOptions.liveProjectSteering?.initialSkills ?? []).map((
      skill: { id: string },
    ) => skill.id),
    expected,
  );
  assertEquals(result.steering.skills.map((skill) => skill.id), expected);
});
