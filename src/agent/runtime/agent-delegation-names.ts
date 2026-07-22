/** Prefix used for the delegate tool exposed to the coordinator agent. */
export const AGENT_DELEGATE_TOOL_PREFIX = "agent_";

/** Provider tool-call names allow only this charset, max 64 chars. */
const PROVIDER_TOOL_NAME_REGEX = /^[A-Za-z0-9_-]{1,64}$/;

/** Whether a delegate id produces a provider-safe `agent_{id}` tool name. */
export function isProviderSafeDelegateId(delegateId: string): boolean {
  return PROVIDER_TOOL_NAME_REGEX.test(`${AGENT_DELEGATE_TOOL_PREFIX}${delegateId}`);
}
