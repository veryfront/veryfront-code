import { AsyncLocalStorage } from "node:async_hooks";
import type { RemoteToolSource } from "#veryfront/tool";

const remoteToolSourceStorage = new AsyncLocalStorage<RemoteToolSource[]>();

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
