import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { agent as createAgent } from "#veryfront/agent";
import { scriptedModel } from "#veryfront/agent/runtime/model-runtime.test-helpers.ts";
import type { RemoteToolSource, Tool, ToolExecutionContext } from "#veryfront/tool";
import { AgentRunSessionManager } from "./session-manager.ts";
import { createRuntimeAgentStreamResponse } from "./run-stream.ts";

const trustedBranch = "0fcc5d59-14a0-415b-9e28-fae46f270e03";
const suppliedBranch = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("canonical shared-host project tool preview scope", () => {
  for (const branch of [trustedBranch, null, undefined]) {
    it(`carries only the trusted preview selector to an authored callback (${branch})`, async () => {
      const observed: Array<ToolExecutionContext | undefined> = [];
      const publisher: Tool = {
        id: "publish_email_ingestion",
        type: "function",
        description: "Publish a synthetic preview artifact",
        inputSchemaJson: { type: "object", properties: {} },
        execute(_input, context) {
          observed.push(context);
          if (!context?.branch) throw new Error("Missing canonical preview branch scope");
          return Promise.resolve({ branch: context.branch });
        },
      };
      const model = scriptedModel([{
        toolCalls: [{
          id: "publish-1",
          name: publisher.id,
          input: { branch: suppliedBranch, branchId: suppliedBranch },
        }],
      }], {
        modelId: "anthropic/shared-host-preview-context",
        provider: "anthropic",
        only: "stream",
      });
      const agent = createAgent({
        id: "ingestion-agent",
        model: "anthropic/shared-host-preview-context",
        system: "Publish the synthetic artifact.",
        skills: false,
        tools: { publish_email_ingestion: true },
        maxSteps: 1,
        resolveModelTransport: () => ({ model }),
      });
      const response = await createRuntimeAgentStreamResponse(
        {
          threadId: crypto.randomUUID(),
          runId: "run_shared_host_preview_context",
          messages: [{ id: "user-1", role: "user", content: "Publish" }],
          tools: [],
          context: [{ type: "json", title: "branch", data: { branchId: suppliedBranch } }],
          forwardedProps: { branch: suppliedBranch, branchId: suppliedBranch },
        },
        agent,
        {
          sessionManager: new AgentRunSessionManager(),
          localTools: { publish_email_ingestion: publisher },
          projectAgentSandbox: {
            projectId: "project-1",
            authToken: "test-token",
            branchId: branch,
          },
        },
      );
      const body = await response.text();
      assertEquals(observed.length, 1);
      assertEquals(observed[0]?.projectId, "project-1");
      assertEquals(observed[0]?.branch, branch);
      if (branch) {
        assertEquals(body.includes("Missing canonical preview branch scope"), false);
      } else {
        assertStringIncludes(body, "Missing canonical preview branch scope");
      }
    });
  }

  it("uses the same trusted preview selector for restrictive remote discovery", async () => {
    const observed: Array<ToolExecutionContext | undefined> = [];
    const source: RemoteToolSource = {
      id: "preview-source",
      listTools(context) {
        observed.push(context);
        return Promise.resolve([{
          name: "preview_read",
          description: "Read preview",
          parameters: { type: "object", properties: {} },
        }]);
      },
      executeTool: () => Promise.resolve({}),
    };
    const model = scriptedModel([{ text: "done" }], {
      modelId: "anthropic/shared-host-preview-discovery",
      provider: "anthropic",
      only: "stream",
    });
    const agent = createAgent({
      id: "preview-discovery-agent",
      model: "anthropic/shared-host-preview-discovery",
      system: "Read preview",
      skills: false,
      tools: { preview_read: true },
      maxSteps: 1,
      resolveModelTransport: () => ({ model }),
    });
    Object.defineProperty(agent.config, "__vfRemoteToolSources", {
      value: [source],
      configurable: true,
    });
    const response = await createRuntimeAgentStreamResponse(
      {
        threadId: crypto.randomUUID(),
        runId: "run_preview_discovery",
        messages: [{ id: "user-1", role: "user", content: "Read" }],
        tools: [],
        context: [],
        forwardedProps: {
          branchId: suppliedBranch,
          runtimeOverrides: { toolAllowlist: ["preview_read"] },
        },
      },
      agent,
      {
        sessionManager: new AgentRunSessionManager(),
        projectAgentSandbox: {
          projectId: "project-1",
          authToken: "test-token",
          branchId: trustedBranch,
        },
      },
    );
    await response.text();
    assertEquals(observed.length > 0, true);
    assertEquals(observed.every((context) => context?.branch === trustedBranch), true);
  });
});
