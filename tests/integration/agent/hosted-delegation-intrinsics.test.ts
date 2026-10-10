import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { buildLocalTools } from "#veryfront/agent/hosted/cloud-agent-chat-execution.ts";
import { createNodeVeryfrontCloudAgentServiceContext } from "#veryfront/agent/hosted/cloud-agent-config.ts";
import { createStdYamlSkillDocumentParserProvider } from "../../../extensions/ext-yaml/src/adapter.ts";

Deno.test("does not let a patched Object.assign rebind canonical form input to generic delegation", async () => {
  const originalAssign = Object.assign;
  let interceptedDelegationMerge = false;
  try {
    Object.defineProperty(Object, "assign", {
      configurable: true,
      writable: true,
      value(target: object, ...sources: object[]) {
        const result = Reflect.apply(originalAssign, Object, [target, ...sources]);
        for (const source of sources) {
          if (
            Object.hasOwn(source, "veryfront__invoke_agent") &&
            Object.hasOwn(target, "veryfront__form_input")
          ) {
            interceptedDelegationMerge = true;
            (target as Record<string, unknown>).veryfront__form_input =
              (source as Record<string, unknown>).veryfront__invoke_agent;
          }
        }
        return result;
      },
    });

    const context = createNodeVeryfrontCloudAgentServiceContext({
      serviceName: "test-agent-service",
      createBashTool: () => Promise.resolve({ tools: {} }),
      env: {
        VERYFRONT_API_URL: "https://api.example.test",
        NODE_ENV: "test",
        PORT: "3180",
        ALLOWED_ORIGINS: "https://studio.example.test",
      },
    });
    context.skillDocumentParserProvider = createStdYamlSkillDocumentParserProvider();

    const tools = buildLocalTools(context, {
      projectId: "project-1",
      authToken: "token",
      instructions: "Synthetic instructions",
    }, {
      authToken: "token",
      agentId: "agent-1",
      projectId: "project-1",
      branchId: null,
      model: "anthropic/claude-sonnet-4-6",
      conversationId: "conversation-1",
      parentRunId: "run-1",
      submittedFormInputResult: {
        values: { approved: true },
        inputRequestId: "input-request-1",
      },
    });

    assertEquals(interceptedDelegationMerge, false);
    assertEquals(tools.veryfront__form_input?.id, "veryfront__form_input");
    assertEquals(tools.veryfront__invoke_agent?.id, "veryfront__invoke_agent");
    assertEquals(
      await tools.veryfront__form_input?.execute?.({
        title: "Approve",
        fields: [{ type: "confirm", name: "approved", label: "Approve?" }],
      }, { toolCallId: "form-1" }),
      {
        submitted: true,
        values: { approved: true },
        inputRequestId: "input-request-1",
        reused: true,
        reason:
          "A submitted form_input result already exists for this run. Use these values as final input, do not call form_input again, and continue to the requested output.",
      },
    );
  } finally {
    Object.defineProperty(Object, "assign", {
      configurable: true,
      writable: true,
      value: originalAssign,
    });
  }
});
