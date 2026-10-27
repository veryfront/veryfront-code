import { createPrivateAsyncLocalStorage } from "#veryfront/security/private-async-context.ts";

type GuardScope = { guard: () => Promise<void>; parent: GuardScope | undefined };
const storage = createPrivateAsyncLocalStorage<GuardScope>();

/** Nested execution may add guards, but cannot remove an inherited host guard. */
export function runWithExecutionOwnershipGuard<T>(
  guard: (() => Promise<void>) | undefined,
  operation: () => T,
): T {
  if (!guard) return operation();
  return storage.run({ guard, parent: storage.getStore() }, operation);
}

/** Point-in-time authority only; the effect endpoint must also fence its atomic commit. */
export function assertExecutionOwnership(): Promise<void> | undefined {
  const scope = storage.getStore();
  if (!scope) return undefined;
  return assertScope(scope);
}

async function assertScope(initial: GuardScope): Promise<void> {
  for (let scope: GuardScope | undefined = initial; scope; scope = scope.parent) {
    await scope.guard();
  }
}

export type RecoveryToolExecution = {
  toolName: string;
  input: Record<string, unknown>;
};
export type RecoveryToolExecutionPolicy = (
  execution: RecoveryToolExecution,
  operation: () => Promise<unknown>,
) => Promise<unknown>;
type PolicyScope = { policy: RecoveryToolExecutionPolicy; parent: PolicyScope | undefined };
const policies = createPrivateAsyncLocalStorage<PolicyScope>();

/** Original host composition only; nested callers cannot remove inherited policies. */
export function runWithRecoveryToolExecutionPolicy<T>(
  policy: RecoveryToolExecutionPolicy | undefined,
  operation: () => T,
): T {
  if (!policy) return operation();
  return policies.run({ policy, parent: policies.getStore() }, operation);
}

/** Undefined preserves the ordinary tool's existing synchronous preparation schedule. */
export function applyRecoveryToolExecutionPolicy(
  execution: RecoveryToolExecution,
  operation: () => Promise<unknown>,
): Promise<unknown> | undefined {
  const scope = policies.getStore();
  if (!scope) return undefined;
  const invoke = (current: PolicyScope | undefined): Promise<unknown> =>
    current ? current.policy(execution, () => invoke(current.parent)) : operation();
  return invoke(scope);
}
