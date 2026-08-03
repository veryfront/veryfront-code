import { INVALID_ARGUMENT } from "#veryfront/errors";

/** Prefix used for the delegate tool exposed to the coordinator agent. */
export const AGENT_DELEGATE_TOOL_PREFIX = "agent_";

/** Provider tool-call names allow only this charset, max 64 chars. */
const PROVIDER_TOOL_NAME_REGEX = /^[A-Za-z0-9_-]{1,64}$/;

/** Whether a delegate id produces a provider-safe `agent_{id}` tool name. */
export function isProviderSafeDelegateId(delegateId: string): boolean {
  return PROVIDER_TOOL_NAME_REGEX.test(`${AGENT_DELEGATE_TOOL_PREFIX}${delegateId}`);
}

/** Normalize and validate the exact delegate ids declared by an agent. */
export function normalizeAgentDelegateIds(
  agentId: string,
  delegates: readonly string[] | undefined,
): string[] | undefined {
  if (delegates === undefined) {
    return undefined;
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const value of delegates) {
    const delegateId = value.trim();
    if (!delegateId || seen.has(delegateId)) {
      continue;
    }
    if (delegateId === agentId) {
      throw INVALID_ARGUMENT.create({ detail: `Agent "${agentId}" cannot delegate to itself.` });
    }
    if (!isProviderSafeDelegateId(delegateId)) {
      throw INVALID_ARGUMENT.create({
        detail:
          `Delegate id "${delegateId}" for agent "${agentId}" produces an invalid tool name ` +
          `"${AGENT_DELEGATE_TOOL_PREFIX}${delegateId}" (must match [A-Za-z0-9_-], max 64 chars).`,
      });
    }
    seen.add(delegateId);
    normalized.push(delegateId);
  }

  return normalized;
}
