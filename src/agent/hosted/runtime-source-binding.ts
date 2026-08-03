import type { RuntimeAgentSourceContext } from "../runtime/agent-invocation-contract.ts";

/** Immutable project source identity served by a standalone agent-service process. */
export type HostedRuntimeSourceIdentity = Readonly<
  Extract<RuntimeAgentSourceContext, { type: "environment" | "release" }>
>;

/** Stable control-plane error returned when a request cannot run on this service snapshot. */
export type HostedRuntimeSourceBindingError = {
  errorCode:
    | "CONTROL_PLANE_AGENT_SOURCE_UNBOUND"
    | "CONTROL_PLANE_AGENT_SOURCE_UNSUPPORTED"
    | "CONTROL_PLANE_AGENT_SOURCE_MISMATCH";
  status: 409 | 503;
};

/** Capture a service-owned immutable copy of a declared runtime source. */
export function snapshotHostedRuntimeSourceIdentity(
  source: HostedRuntimeSourceIdentity,
): HostedRuntimeSourceIdentity {
  return Object.freeze({ ...source });
}

/** Verify that a control-plane request addresses the exact source snapshot served here. */
export function verifyHostedRuntimeSourceBinding(
  boundSource: HostedRuntimeSourceIdentity | undefined,
  requestedSource: RuntimeAgentSourceContext,
): HostedRuntimeSourceBindingError | undefined {
  if (!boundSource) {
    return { errorCode: "CONTROL_PLANE_AGENT_SOURCE_UNBOUND", status: 503 };
  }

  if (requestedSource.type === "branch") {
    return { errorCode: "CONTROL_PLANE_AGENT_SOURCE_UNSUPPORTED", status: 409 };
  }

  if (boundSource.type === "release" && requestedSource.type === "release") {
    return boundSource.releaseId === requestedSource.releaseId
      ? undefined
      : { errorCode: "CONTROL_PLANE_AGENT_SOURCE_MISMATCH", status: 409 };
  }

  if (boundSource.type === "environment" && requestedSource.type === "environment") {
    return boundSource.environmentName === requestedSource.environmentName &&
        boundSource.releaseId === requestedSource.releaseId
      ? undefined
      : { errorCode: "CONTROL_PLANE_AGENT_SOURCE_MISMATCH", status: 409 };
  }

  return { errorCode: "CONTROL_PLANE_AGENT_SOURCE_MISMATCH", status: 409 };
}
