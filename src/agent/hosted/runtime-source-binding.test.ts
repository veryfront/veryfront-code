import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  snapshotHostedRuntimeSourceIdentity,
  verifyHostedRuntimeSourceBinding,
} from "./runtime-source-binding.ts";

describe("verifyHostedRuntimeSourceBinding", () => {
  it("snapshots the declared identity so caller mutation cannot retarget a running service", () => {
    const configuredSource = { type: "release", releaseId: "release-42" } as const;
    const snapshot = snapshotHostedRuntimeSourceIdentity(configuredSource);
    (configuredSource as { releaseId: string }).releaseId = "release-43";

    assertEquals(snapshot, { type: "release", releaseId: "release-42" });
    assertEquals(Object.isFrozen(snapshot), true);
  });

  it("accepts only an exact immutable source identity", () => {
    assertEquals(
      verifyHostedRuntimeSourceBinding(
        { type: "environment", environmentName: "production", releaseId: "release-42" },
        { type: "environment", environmentName: "production", releaseId: "release-42" },
      ),
      undefined,
    );
    assertEquals(
      verifyHostedRuntimeSourceBinding(
        { type: "release", releaseId: "release-42" },
        { type: "release", releaseId: "release-42" },
      ),
      undefined,
    );
  });

  it("rejects control-plane execution when the service has no source binding", () => {
    assertEquals(
      verifyHostedRuntimeSourceBinding(undefined, { type: "release", releaseId: "release-42" }),
      { errorCode: "CONTROL_PLANE_AGENT_SOURCE_UNBOUND", status: 503 },
    );
  });

  it("rejects mutable branch selection", () => {
    assertEquals(
      verifyHostedRuntimeSourceBinding(
        { type: "release", releaseId: "release-42" },
        { type: "branch", branch: "main" },
      ),
      { errorCode: "CONTROL_PLANE_AGENT_SOURCE_UNSUPPORTED", status: 409 },
    );
  });

  it("rejects release, environment, or source-kind mismatches", () => {
    const boundSource = {
      type: "environment",
      environmentName: "production",
      releaseId: "release-42",
    } as const;

    assertEquals(
      verifyHostedRuntimeSourceBinding(boundSource, {
        type: "environment",
        environmentName: "staging",
        releaseId: "release-42",
      }),
      { errorCode: "CONTROL_PLANE_AGENT_SOURCE_MISMATCH", status: 409 },
    );
    assertEquals(
      verifyHostedRuntimeSourceBinding(boundSource, {
        type: "environment",
        environmentName: "production",
        releaseId: "release-43",
      }),
      { errorCode: "CONTROL_PLANE_AGENT_SOURCE_MISMATCH", status: 409 },
    );
    assertEquals(
      verifyHostedRuntimeSourceBinding(boundSource, {
        type: "release",
        releaseId: "release-42",
      }),
      { errorCode: "CONTROL_PLANE_AGENT_SOURCE_MISMATCH", status: 409 },
    );
  });
});
