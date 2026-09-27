import { AsyncLocalStorage } from "node:async_hooks";
import type { ProjectTraceProvider } from "#veryfront/extensions/observability/tracing-exporter.ts";

const storage = new AsyncLocalStorage<ProjectTraceProvider | undefined>();
const getStore = AsyncLocalStorage.prototype.getStore;
const run = AsyncLocalStorage.prototype.run;
const apply = Reflect.apply;

/** Internal runtime capability; never selected by user span attributes or baggage. */
export function getProjectTraceProvider(): ProjectTraceProvider | undefined {
  return apply(getStore, storage, []) as ProjectTraceProvider | undefined;
}

/** A missing provider deliberately clears any outer project's scope. */
export function runWithProjectTraceProvider<T>(
  provider: ProjectTraceProvider | undefined,
  operation: () => T,
): T {
  return apply(run, storage, [provider, operation]) as T;
}
