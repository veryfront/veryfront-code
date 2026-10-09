import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { tool } from "#veryfront/tool";
import { toolRegistryInternal } from "#veryfront/tool/registry.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import type { ParsedHostedChatRequest } from "#veryfront/agent/hosted/chat-request-parser.ts";
import { prepareVeryfrontCloudHostedChatExecution } from "#veryfront/agent/hosted/cloud-chat-execution-preparation.ts";
import { hydrateActiveSkillStateFromMessages } from "#veryfront/agent/runtime/skill-policy-enforcement.ts";

function createRequest(): ParsedHostedChatRequest {
  return {
    agentId: undefined,
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

Deno.test("production cloud preparation restores only verified noncolliding legacy skill history", async () => {
  for (
    const mode of [
      "verified",
      "ordinary",
      "direct collision",
      "qualified collision",
      "hidden owner",
    ]
  ) {
    const id = mode === "direct collision" ? "load_skill" : "agent-1--load_skill";
    const previous = toolRegistryInternal.getOwn(id);
    const collision = mode.includes("collision") || mode === "hidden owner";
    if (collision) {
      toolRegistryInternal.delete(id);
      const definition = tool({
        id,
        description: "Project loader",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: () => ({}),
      });
      definition.shortName = "load_skill";
      definition.ownerAgentId = mode === "hidden owner" ? "other-agent" : "agent-1";
      toolRegistryInternal.register(id, definition);
    }
    try {
      const request = createRequest();
      request.serverEnvelopeVerified = mode === "ordinary" ? undefined : true;
      request.serverResolvedTrustedHostedHistoryMessageIds = ["stored-legacy"];
      request.messages.push({
        id: "stored-legacy",
        role: "assistant",
        parts: [{
          type: "dynamic-tool",
          toolName: "load_skill",
          toolCallId: "load",
          state: "output-available",
          input: { skillId: "plan" },
          output: { skillId: "plan", instructions: "Plan safely.", references: [], scripts: [] },
        }],
      });
      const result = await prepareVeryfrontCloudHostedChatExecution({
        request,
        agentConfig: { id: "agent-1" },
        apiUrl: "https://api.example.test",
        abortSignal: new AbortController().signal,
        fetchSteering: () => Promise.resolve({ instructions: "Base", skills: [] }),
        buildInstructions: () => "Base",
        createRuntime: () =>
          Promise.resolve({
            runtimeKind: "framework",
            modelId: "test",
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
        hydrateActiveSkillStateFromMessages(result.finalMessages).activeSkillId,
        mode === "verified" || mode === "hidden owner" ? "plan" : undefined,
      );
    } finally {
      if (collision) {
        toolRegistryInternal.delete(id);
        if (previous) toolRegistryInternal.register(id, previous);
      }
    }
  }
});
