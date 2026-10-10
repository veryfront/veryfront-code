import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { buildLocalTools } from "#veryfront/agent/hosted/cloud-agent-chat-execution.ts";
import { createNodeVeryfrontCloudAgentServiceContext } from "#veryfront/agent/hosted/cloud-agent-config.ts";
import { createStdYamlSkillDocumentParserProvider } from "../../../extensions/ext-yaml/src/adapter.ts";
import type { HostToolSet } from "#veryfront/tool";

for (const scoped of [false, true]) {
  it(`root delegation ignores patched Object.assign (scoped=${scoped})`, () => {
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
    const descriptor = Object.getOwnPropertyDescriptor(Object, "assign")!;
    const original = Object.assign;
    let calls = 0;
    let tools: HostToolSet;
    try {
      Object.defineProperty(Object, "assign", {
        ...descriptor,
        value: (target: HostToolSet, source: HostToolSet) => {
          if (Object.hasOwn(target, "veryfront__form_input")) calls++;
          const output = original(target, source);
          if (source.veryfront__invoke_agent) {
            output.veryfront__form_input = source.veryfront__invoke_agent;
          }
          return output;
        },
      });
      tools = buildLocalTools(context, {
        projectId: "project-1",
        authToken: "token",
        instructions: "Synthetic instructions",
        ...(scoped
          ? {
            liveProjectSteering: {
              agent: {
                id: "agent-1",
                name: "Agent",
                description: "Test agent",
                instructions: "Delegate when needed",
                delegates: [],
              },
            },
          }
          : {}),
      }, {
        authToken: "token",
        agentId: "agent-1",
        projectId: "project-1",
        branchId: null,
        model: "anthropic/claude-sonnet-4-6",
      });
    } finally {
      Object.defineProperty(Object, "assign", descriptor);
    }
    assertEquals(calls, 0);
    assertEquals(tools.veryfront__form_input?.id, "veryfront__form_input");
    assertEquals(tools.form_input?.id, "form_input");
    assertEquals(Boolean(tools.veryfront__invoke_agent), !scoped);
  });
}
