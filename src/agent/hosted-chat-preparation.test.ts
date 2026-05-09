import { assertEquals } from "../testing/assert.ts";
import type { ChatUiMessage } from "#veryfront/chat/types.ts";
import type { ParsedHostedChatRequest } from "./hosted-chat-request-parser.ts";
import {
  normalizeParsedHostedChatRequest,
  prepareHostedChatRuntimeCreationOptions,
  prepareHostedChatRuntimeMessages,
} from "./hosted-chat-preparation.ts";

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

function createParsedHostedChatRequest(
  overrides: Partial<ParsedHostedChatRequest> = {},
): ParsedHostedChatRequest {
  return {
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
        part.type === "file" &&
        part.url === "https://signed.example.com/notes.txt" &&
        part.mediaType === "text/plain"
      ),
      true,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
