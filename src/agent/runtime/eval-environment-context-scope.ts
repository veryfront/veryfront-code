import { createPrivateAsyncLocalStorage } from "#veryfront/security/private-async-context.ts";

const scopes = createPrivateAsyncLocalStorage<
  { active: boolean; agentId: string; environmentContext: string }
>();

/**
 * Run one local eval case with the environment context Studio would send.
 * Only the eval's target agent reads it: delegated child agents in the same
 * call keep their own configuration. The scope ends when the case settles, so
 * detached work that outlives the case falls back to the agent configuration.
 */
export async function runWithEvalEnvironmentContext<T>(
  agentId: string,
  environmentContext: string,
  run: () => Promise<T>,
): Promise<T> {
  const scope = { active: true, agentId, environmentContext };
  try {
    return await scopes.run(scope, run);
  } finally {
    scope.active = false;
  }
}

/** Read the active eval case's environment context for this agent, if any. */
export function readEvalEnvironmentContext(agentId: string): string | undefined {
  const scope = scopes.getStore();
  return scope?.active === true && scope.agentId === agentId ? scope.environmentContext : undefined;
}
