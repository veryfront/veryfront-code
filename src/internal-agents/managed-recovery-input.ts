import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";
import {
  getVerifiedControlPlaneRecoveryAdmission,
  type VerifiedControlPlaneRequestClaims,
} from "./control-plane-auth.ts";
import type { RuntimeRunAgentInput } from "./schema.ts";

// Object identity connects the exact signed request to the sanitized runtime input.
// Neither forwarded props nor a copied claims/input object can carry this authority.
const claimsByInput = createPrivateWeakStore<
  RuntimeRunAgentInput,
  VerifiedControlPlaneRequestClaims
>();

export function bindManagedRecoveryInput(
  input: RuntimeRunAgentInput,
  claims: VerifiedControlPlaneRequestClaims | undefined,
): void {
  if (!claims) return;
  const admission = getVerifiedControlPlaneRecoveryAdmission(claims);
  if (!admission) return;
  if (admission.identity.publicRunId !== input.runId) {
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
