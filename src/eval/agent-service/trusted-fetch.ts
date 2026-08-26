type AgentServiceFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const trustedAgentIds = new WeakMap<AgentServiceFetch, string>();
const weakMapGet = WeakMap.prototype.get;
const weakMapSet = WeakMap.prototype.set;
const apply = Reflect.apply;

/** @internal Bind a local eval transport to the exact agent it already resolved. */
export function bindTrustedLocalEvalFetch(
  requestFetch: AgentServiceFetch,
  agentId: string,
): AgentServiceFetch {
  apply(weakMapSet, trustedAgentIds, [requestFetch, agentId]);
  return requestFetch;
}

/** @internal Read the server-established agent binding for a local eval transport. */
export function trustedLocalEvalFetchAgentId(
  requestFetch: AgentServiceFetch | undefined,
): string | undefined {
  return requestFetch
    ? apply(weakMapGet, trustedAgentIds, [requestFetch]) as string | undefined
    : undefined;
}
