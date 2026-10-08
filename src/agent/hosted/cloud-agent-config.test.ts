import { assertEquals, assertNotEquals } from "#veryfront/testing/assert.ts";
import type { CreateSandboxBashTool } from "#veryfront/sandbox";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { tool } from "#veryfront/tool";
import { hasTrustedHostToolProvenance } from "#veryfront/tool/host-tool-provenance.ts";
import { toolRegistryInternal } from "#veryfront/tool/registry.ts";
import {
  buildLocalTools,
  createNodeVeryfrontCloudAgentServiceRuntimeOptions,
} from "./cloud-agent-chat-execution.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { hasRuntimeObservationCaptureOptIn } from "#veryfront/runtime/runtime-observation-carrier.ts";
import {
  createNodeVeryfrontCloudAgentServiceContext,
  resolveProviderReplayCheckpointEmissionBootstrap,
  resolveRuntimeObservationCaptureBootstrap,
} from "./cloud-agent-config.ts";
import { createStdYamlSkillDocumentParserProvider } from "../../../extensions/ext-yaml/src/adapter.ts";

describe("cloud agent provider replay bootstrap", () => {
  it("snapshots the deployment-owned gate before request-scoped environment overlays", () => {
    assertEquals(
      resolveProviderReplayCheckpointEmissionBootstrap({
        env: { VERYFRONT_ENABLE_PROVIDER_REPLAY_CHECKPOINT_EMISSION: "1" },
        processTarget: { env: { VERYFRONT_ENABLE_PROVIDER_REPLAY_CHECKPOINT_EMISSION: "0" } },
      }),
      true,
    );
    assertEquals(
      resolveProviderReplayCheckpointEmissionBootstrap({
        env: { VERYFRONT_ENABLE_PROVIDER_REPLAY_CHECKPOINT_EMISSION: "0" },
        processTarget: { env: { VERYFRONT_ENABLE_PROVIDER_REPLAY_CHECKPOINT_EMISSION: "1" } },
      }),
      false,
    );
    assertEquals(resolveProviderReplayCheckpointEmissionBootstrap({ env: {} }), false);
  });
});

describe("cloud agent runtime observation capture bootstrap", () => {
  it("keeps exact model-call capture default-off at service assembly", () => {
    assertEquals(
      hasRuntimeObservationCaptureOptIn(resolveRuntimeObservationCaptureBootstrap({})),
      false,
    );
    assertEquals(
      hasRuntimeObservationCaptureOptIn(
        resolveRuntimeObservationCaptureBootstrap({ hostedModelCallCapture: true }),
      ),
      true,
    );
  });
});

describe("cloud agent service runtime options", () => {
  it("propagates the deployment artifact to the agent service runtime", () => {
    const createBashTool: CreateSandboxBashTool = () => Promise.resolve({ tools: {} });
    const context = createNodeVeryfrontCloudAgentServiceContext({
      serviceName: "test-agent-service",
      deploymentArtifact: "20261007183045-a1b2c3d4e5f6",
      createBashTool,
      env: {
        VERYFRONT_API_URL: "https://api.example.test",
        NODE_ENV: "test",
        PORT: "3180",
        ALLOWED_ORIGINS: "https://studio.example.test",
      },
    });

    const runtimeOptions = createNodeVeryfrontCloudAgentServiceRuntimeOptions(context);

    assertEquals(runtimeOptions.deploymentArtifact, "20261007183045-a1b2c3d4e5f6");
  });

  it("preserves a project invoke_agent collision beside the canonical platform delegate", async () => {
    const projectInvokeAgent = tool({
      id: "invoke_agent",
      description: "Project-owned invoke marker",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: () => ({ owner: "project", marker: "project-invoke-agent" }),
    });
    toolRegistryInternal.registerShared("invoke_agent", projectInvokeAgent);
    try {
      const createBashTool: CreateSandboxBashTool = () => Promise.resolve({ tools: {} });
      const context = createNodeVeryfrontCloudAgentServiceContext({
        serviceName: "test-agent-service",
        createBashTool,
        env: {
          VERYFRONT_API_URL: "https://api.example.test",
          NODE_ENV: "test",
          PORT: "3180",
          ALLOWED_ORIGINS: "https://studio.example.test",
        },
      });
      context.skillDocumentParserProvider = createStdYamlSkillDocumentParserProvider();

      const tools = buildLocalTools(
        context,
        {
          projectId: "project-1",
          authToken: "token",
          instructions: "Synthetic instructions",
        },
        {
          authToken: "token",
          agentId: "agent-1",
          projectId: "project-1",
          branchId: null,
          model: "anthropic/claude-sonnet-4-6",
        },
      );

      assertEquals(tools.invoke_agent, projectInvokeAgent);
      assertEquals(await tools.invoke_agent?.execute({}), {
        owner: "project",
        marker: "project-invoke-agent",
      });
      assertNotEquals(tools.veryfront__invoke_agent, projectInvokeAgent);
      assertEquals(hasTrustedHostToolProvenance(tools.veryfront__invoke_agent), true);
      assertEquals(tools.veryfront__invoke_agent?.id, "veryfront__invoke_agent");
      assertEquals(
        ["invoke_agent", "veryfront__invoke_agent"].every((name) => name in tools),
        true,
      );
    } finally {
      toolRegistryInternal.clearAll();
    }
  });

  it("registers canonical aliases for trusted root platform tools", () => {
    const createBashTool: CreateSandboxBashTool = () => Promise.resolve({ tools: {} });
    const context = createNodeVeryfrontCloudAgentServiceContext({
      serviceName: "test-agent-service",
      createBashTool,
      env: {
        VERYFRONT_API_URL: "https://api.example.test",
        NODE_ENV: "test",
        PORT: "3180",
        ALLOWED_ORIGINS: "https://studio.example.test",
      },
    });
    context.skillDocumentParserProvider = createStdYamlSkillDocumentParserProvider();

    const tools = buildLocalTools(
      context,
      {
        projectId: "project-1",
        authToken: "token",
        instructions: "Synthetic instructions",
        allowDelegation: false,
      },
      {
        authToken: "token",
        agentId: "agent-1",
        projectId: "project-1",
        branchId: null,
        model: "anthropic/claude-sonnet-4-6",
      },
    );

    assertEquals("veryfront__form_input" in tools, true);
    assertEquals("veryfront__load_skill" in tools, true);
    assertEquals("veryfront__sleep" in tools, true);
    assertEquals("veryfront__web_fetch" in tools, true);
  });
});
