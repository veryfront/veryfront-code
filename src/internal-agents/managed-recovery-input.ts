import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";
import {
  getVerifiedControlPlaneRecoveryAdmission,
  type VerifiedControlPlaneRequestClaims,
} from "./control-plane-auth.ts";
import type { InternalAgentStreamRequest, RuntimeRunAgentInput } from "./schema.ts";

// Object identity connects the exact signed request to the sanitized runtime input.
// Neither forwarded props nor a copied claims/input object can carry this authority.
const claimsByInput = createPrivateWeakStore<
  RuntimeRunAgentInput,
  VerifiedControlPlaneRequestClaims
>();

/** Compare the executed source before project-controlled discovery or environment setup. */
export function assertManagedRecoveryExecutionBinding(
  input: InternalAgentStreamRequest,
  claims: VerifiedControlPlaneRequestClaims | undefined,
): void {
  if (!claims) return;
  const admission = getVerifiedControlPlaneRecoveryAdmission(claims);
  if (!admission) return;
  const sourceEnvironmentId = input.sourceProject
    ? input.sourceProject.sourceTargetEnvironmentId ??
      input.sourceProject.runtimeTargetEnvironmentId
    : input.sourceTargetEnvironmentId ?? input.runtimeTargetEnvironmentId;
  if (
    admission.identity.publicRunId !== input.runId ||
    admission.identity.agentId !== input.agentId ||
    admission.identity.threadId !== input.threadId ||
    input.agentSource.type === "branch" ||
    input.agentSource.releaseId !== admission.sourceBinding.releaseId ||
    sourceEnvironmentId !== admission.sourceBinding.environmentId ||
    (input.sourceProject?.projectId ?? claims.project_id) !== admission.sourceBinding.projectId
  ) throw new Error("Managed recovery execution does not match signed identity or source");
}

export function bindManagedRecoveryInput(
  input: RuntimeRunAgentInput,
  claims: VerifiedControlPlaneRequestClaims | undefined,
): void {
  if (!claims) return;
  const admission = getVerifiedControlPlaneRecoveryAdmission(claims);
  if (!admission) return;
  if (
    admission.identity.publicRunId !== input.runId ||
    admission.identity.threadId !== input.threadId
  ) {
    throw new Error("Managed recovery input does not match signed run identity");
  }
  claimsByInput.set(input, claims);
}

export function getManagedRecoveryInputClaims(
  input: RuntimeRunAgentInput,
): VerifiedControlPlaneRequestClaims | undefined {
  const claims = claimsByInput.get(input);
  if (claims && !getVerifiedControlPlaneRecoveryAdmission(claims)) {
    throw new Error("Managed recovery input admission expired");
  }
  return claims;
}
