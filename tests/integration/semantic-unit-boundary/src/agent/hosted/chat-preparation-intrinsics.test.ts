import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import type { ParsedHostedChatRequest } from "#veryfront/agent/hosted/chat-request-parser.ts";
import { prepareHostedChatRuntimeCreationOptions } from "#veryfront/agent/hosted/chat-preparation.ts";
import { buildVeryfrontCloudRuntimeInstructions } from "#veryfront/agent/hosted/cloud-runtime-system-messages.ts";
import { isLoadSkillToolName } from "#veryfront/agent/runtime/skill-policy-enforcement.ts";

// Prototype replacement is a process-global project bootstrap effect, so this
// regression belongs at the integration boundary rather than in colocated units.
function createParsedHostedChatRequest(): ParsedHostedChatRequest {
  return {
    agentId: undefined,
    userId: "user-1",
    authToken: "auth-token",
    messages: [{ id: "user-message-1", role: "user", parts: [{ type: "text", text: "Hello" }] }],
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
  };
}

for (const denySkillLoader of [false, true]) {
  it(`prepareHostedChatRuntimeCreationOptions keeps ${denySkillLoader ? "denied" : "authorized"} skill catalog after Array.prototype.some is replaced`, async () => {
    const originalSome = Array.prototype.some;
    const originalApply = Reflect.apply;
    Array.prototype.some = function (predicate, thisArg) {
      return predicate === isLoadSkillToolName
        ? denySkillLoader
        : originalApply(originalSome, this, [predicate, thisArg]);
    };
    try {
      let visibleToolNames: readonly string[] | undefined;
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
        hostToolPolicy: {
          allow: denySkillLoader ? ["get_agent"] : ["veryfront__load_skill", "tool_search"],
        },
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
      assertEquals(system.includes("Deploy the project"), !denySkillLoader);
      assertEquals(visibleToolNames?.includes("veryfront__load_skill") ?? false, !denySkillLoader);
    } finally {
      Array.prototype.some = originalSome;
    }
  });
}
