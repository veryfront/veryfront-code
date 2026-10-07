import { assertEquals } from "#veryfront/testing/assert.ts";
import type { CreateSandboxBashTool } from "#veryfront/sandbox";
import { createNodeVeryfrontCloudAgentServiceRuntimeOptions } from "./cloud-agent-chat-execution.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { hasRuntimeObservationCaptureOptIn } from "#veryfront/runtime/runtime-observation-carrier.ts";
import {
  createNodeVeryfrontCloudAgentServiceContext,
  resolveProviderReplayCheckpointEmissionBootstrap,
  resolveRuntimeObservationCaptureBootstrap,
} from "./cloud-agent-config.ts";

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
});
