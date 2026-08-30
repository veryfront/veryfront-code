import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { resolveProviderReplayCheckpointEmissionBootstrap } from "./cloud-agent-config.ts";

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
