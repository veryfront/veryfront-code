import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ChatSystemMessage } from "#veryfront/chat/types.ts";
import type {
  HostedChatRuntimeAgent,
  HostedChatRuntimeCreationOptions,
} from "./hosted-chat-runtime-contract.ts";
import type { ParsedHostedChatRequest } from "./hosted-chat-request-parser.ts";
import type { RuntimeAgentThinkingConfig } from "./runtime-agent-definition.ts";
import type { RuntimeSkillDefinition } from "./runtime-skill-metadata.ts";
import {
  createVeryfrontCloudHostedChatExecutionRootRunOptions,
  prepareVeryfrontCloudHostedChatExecution,
} from "./veryfront-cloud-hosted-chat-execution-preparation.ts";

type TestAgentConfig = {
  id: string;
  model?: string;
  maxSteps?: number;
};

type TestRuntimeResult = {
  runtimeKind: "framework";
  agent: HostedChatRuntimeAgent;
  modelId: string;
  cleanup: () => Promise<void>;
};

async function* emptyStream() {}

function createRuntimeAgent(): HostedChatRuntimeAgent {
  return {
    stream: () =>
      Promise.resolve({
        steps: Promise.resolve([]),
        toUIMessageStream: () => emptyStream(),
      }),
  };
}

function createRequest(): ParsedHostedChatRequest {
  return {
    userId: "user-1",
    authToken: "auth-token",
    messages: [
      {
        id: "message-1",
        role: "user",
        parts: [{ type: "text", text: "Hello" }],
      },
    ],
    validatedContext: {
      conversationId: undefined,
      projectId: null,
      branchId: null,
    },
    conversationId: undefined,
    projectId: null,
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
  };
}

describe("agent/veryfront-cloud-hosted-chat-execution-preparation", () => {
  it("prepares hosted chat execution with Veryfront Cloud model defaults", async () => {
    let runtimeOptions:
      | HostedChatRuntimeCreationOptions<TestAgentConfig, RuntimeAgentThinkingConfig>
      | undefined;
    const skills: RuntimeSkillDefinition[] = [];

    const result = await prepareVeryfrontCloudHostedChatExecution({
      request: createRequest(),
      agentConfig: {
        id: "agent-1",
        model: "openai/gpt-5.2",
        maxSteps: 12,
      },
      apiUrl: "https://api.example.com",
      abortSignal: new AbortController().signal,
      fetchSteering: () => Promise.resolve({ instructions: "Project rules", skills }),
      buildInstructions: (input): ChatSystemMessage[] => [
        {
          role: "system",
          content: `${input.agentConfig.id}: ${input.instructions}`,
        },
      ],
      createRuntime: (options) => {
        runtimeOptions = options;
        return Promise.resolve({
          runtimeKind: "framework",
          agent: createRuntimeAgent(),
          modelId: options.model ?? "default-model",
          cleanup: () => Promise.resolve(),
        });
      },
    });

    assertEquals(runtimeOptions?.model, "veryfront-cloud/openai/gpt-5.2");
    assertEquals(runtimeOptions?.maxSteps, 12);
    assertEquals(runtimeOptions?.instructions, [
      {
        role: "system",
        content: "agent-1: Project rules",
      },
    ]);
    assertEquals(result.rootRunContext.durableRootRun, null);
    assertEquals(result.runtime.modelId, "veryfront-cloud/openai/gpt-5.2");
  });

  it("builds default root-run persistence diagnostics and preserves overrides", () => {
    const loggerCalls: unknown[] = [];
    const instrumentation = {
      trace: <TResult>(_operationName: string, operation: () => Promise<TResult>) => operation(),
    };

    const defaults = createVeryfrontCloudHostedChatExecutionRootRunOptions({
      logger: {
        error: (_message, metadata) => loggerCalls.push(metadata),
      },
      rootRun: {
        implementationKind: "custom-kind",
        instrumentation,
      },
    });

    const failure = {
      conversationId: "conversation-1",
      messageId: "message-1",
      status: 500,
      statusText: "Internal Server Error",
      body: "error",
    };
    defaults.onPersistLatestUserMessageFailure?.(failure);

    assertEquals(defaults.persistLatestUserMessageOperation, "Persist durable root user message");
    assertEquals(
      defaults.missingUserMessageErrorMessage,
      "DURABLE_CHAT_ROOT_REQUIRES_USER_MESSAGE",
    );
    assertEquals(defaults.implementationKind, "custom-kind");
    assertStrictEquals(defaults.instrumentation, instrumentation);
    assertEquals(loggerCalls, [failure]);

    const customFailure = (customFailureInput: unknown) => loggerCalls.push(customFailureInput);
    const overridden = createVeryfrontCloudHostedChatExecutionRootRunOptions({
      logger: {
        error: (_message, metadata) => loggerCalls.push(metadata),
      },
      rootRun: {
        persistLatestUserMessageOperation: "Persist custom message",
        missingUserMessageErrorMessage: "CUSTOM_MISSING_MESSAGE",
        onPersistLatestUserMessageFailure: customFailure,
      },
    });

    assertEquals(overridden.persistLatestUserMessageOperation, "Persist custom message");
    assertEquals(overridden.missingUserMessageErrorMessage, "CUSTOM_MISSING_MESSAGE");
    assertStrictEquals(overridden.onPersistLatestUserMessageFailure, customFailure);
  });
});
