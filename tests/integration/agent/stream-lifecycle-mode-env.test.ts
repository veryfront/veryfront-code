import { assertEquals } from "#veryfront/testing/assert";
import { afterEach, describe, it } from "#veryfront/testing/bdd";
import { deleteEnv, getEnv, setEnv } from "#veryfront/compat/process.ts";
import { resolveStreamLifecycleModeFromEnv } from "#veryfront/agent/runtime/stream-lifecycle-mode.ts";

const ENV_KEY = "VF_STREAM_LIFECYCLE_MODE";

describe("resolveStreamLifecycleModeFromEnv", () => {
  const previous = getEnv(ENV_KEY);

  afterEach(() => {
    if (previous === undefined) {
      deleteEnv(ENV_KEY);
    } else {
      setEnv(ENV_KEY, previous);
    }
  });

  it("defaults to legacy when the variable is unset", () => {
    deleteEnv(ENV_KEY);
    assertEquals(
      resolveStreamLifecycleModeFromEnv(),
      "legacy",
      "an unset VF_STREAM_LIFECYCLE_MODE must keep the legacy rollout default",
    );
  });

  it("selects the active and shadow lifecycles from the variable", () => {
    setEnv(ENV_KEY, "active");
    assertEquals(
      resolveStreamLifecycleModeFromEnv(),
      "active",
      "VF_STREAM_LIFECYCLE_MODE=active must select the active lifecycle",
    );
    setEnv(ENV_KEY, "shadow");
    assertEquals(
      resolveStreamLifecycleModeFromEnv(),
      "shadow",
      "VF_STREAM_LIFECYCLE_MODE=shadow must select the shadow lifecycle",
    );
  });

  it("falls back to legacy for unknown values", () => {
    setEnv(ENV_KEY, "bogus");
    assertEquals(
      resolveStreamLifecycleModeFromEnv(),
      "legacy",
      "an unknown VF_STREAM_LIFECYCLE_MODE must fall back to legacy",
    );
  });
});
