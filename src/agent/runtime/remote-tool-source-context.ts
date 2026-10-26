import { createPrivateAsyncLocalStorage } from "#veryfront/security/private-async-context.ts";
import type { RemoteToolSource } from "#veryfront/tool";

const remoteToolSourceStorage = createPrivateAsyncLocalStorage<RemoteToolSource[]>();

/** Return the exact request-scoped remote tool sources active at this runtime boundary. */
export function getActiveRuntimeRemoteToolSources(): RemoteToolSource[] | undefined {
  return remoteToolSourceStorage.getStore();
}

/** Establish the exact remote tool sources available to nested local execution. */
export function runWithExactRuntimeRemoteToolSources<T>(
  sources: RemoteToolSource[],
  fn: () => T,
): T {
  return remoteToolSourceStorage.run(sources, fn);
}

/** Preserve the active source boundary when this runtime has no boundary of its own. */
export function runWithRuntimeRemoteToolSources<T>(
  sources: RemoteToolSource[] | undefined,
  fn: () => T,
): T {
  return sources === undefined ? fn() : remoteToolSourceStorage.run(sources, fn);
}
