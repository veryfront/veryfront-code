import { createPrivateAsyncLocalStorage } from "#veryfront/security/private-async-context.ts";

const storage = createPrivateAsyncLocalStorage<string>();

/** @internal Scope a host-created local eval identity without durable writer authority. */
export function runWithLocalEvalIdentity<T>(operation: (runId: string) => T): T {
  const runId = crypto.randomUUID();
  return storage.run(runId, () => operation(runId));
}

/** @internal Read only the host-scoped local eval identity, never agent-authored context. */
export function getLocalEvalIdentity(): string | undefined {
  return storage.getStore();
}
