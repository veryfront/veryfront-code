/** Signed caller prohibition applies to both public delegation tool spellings. */
export function isHostedDelegationToolAllowed(
  name: string,
  allowDelegation: boolean | undefined,
): boolean {
  return allowDelegation !== false ||
    (name !== "invoke_agent" && name !== "veryfront__invoke_agent");
}
