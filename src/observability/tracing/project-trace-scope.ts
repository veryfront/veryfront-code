import { AsyncLocalStorage } from "node:async_hooks";
import type { ProjectTraceProvider } from "#veryfront/extensions/observability/tracing-exporter.ts";

const storage = new AsyncLocalStorage<ProjectTraceProvider | undefined>();
const getStore = AsyncLocalStorage.prototype.getStore;
const run = AsyncLocalStorage.prototype.run;
const apply = Reflect.apply;
const spanProviders = new WeakMap<object, ProjectTraceProvider>();
const weakGet = WeakMap.prototype.get;
const weakSet = WeakMap.prototype.set;

/** Retain ownership when a public span handle outlives its request context. */
export function rememberProjectSpan(span: object): void {
  const provider = getProjectTraceProvider();
  if (provider && !apply(weakGet, spanProviders, [span])) {
    apply(weakSet, spanProviders, [span, provider]);
  }
}

export function getSpanProjectProvider(span: object): ProjectTraceProvider | undefined {
  return apply(weakGet, spanProviders, [span]) as ProjectTraceProvider | undefined;
}

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
