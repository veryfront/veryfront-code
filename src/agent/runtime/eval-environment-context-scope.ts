import { createPrivateAsyncLocalStorage } from "#veryfront/security/private-async-context.ts";

const scopes = createPrivateAsyncLocalStorage<{ agentId: string; environmentContext: string }>();

/**
 * Run one local eval case with the environment context Studio would send.
 * Only the eval's target agent reads it: delegated child agents in the same
 * call keep their own configuration.
 */
export function runWithEvalEnvironmentContext<T>(
  agentId: string,
  environmentContext: string,
  run: () => Promise<T>,
): Promise<T> {
  return scopes.run({ agentId, environmentContext }, run);
}

/** Read the active eval case's environment context for this agent, if any. */
export function readEvalEnvironmentContext(agentId: string): string | undefined {
  const scope = scopes.getStore();
  return scope?.agentId === agentId ? scope.environmentContext : undefined;
}
