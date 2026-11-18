import { createPrivateAsyncLocalStorage } from "#veryfront/security/private-async-context.ts";
import { privateTextTrim } from "#veryfront/security/private-text.ts";

const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectHasOwn = Object.hasOwn;
const ArrayIsArray = Array.isArray;

/**
 * The eval or example environment context a durable eval run forwards as
 * `forwardedProps.veryfront.environmentContext`. Own data properties only, at
 * each step: project code runs in this realm and can put `veryfront` or
 * `environmentContext` on Object.prototype.
 */
export function readForwardedEvalEnvironmentContext(forwardedProps: unknown): string | undefined {
  const veryfront = readOwnDataProperty(forwardedProps, "veryfront");
  const value = readOwnDataProperty(veryfront, "environmentContext");
  return typeof value === "string" && privateTextTrim(value) !== "" ? value : undefined;
}

function readOwnDataProperty(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null || ArrayIsArray(value)) return undefined;
  const descriptor = ObjectGetOwnPropertyDescriptor(value, key);
  return descriptor && ObjectHasOwn(descriptor, "value") ? descriptor.value : undefined;
}

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
