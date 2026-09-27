import { AsyncLocalStorage } from "node:async_hooks";
import type { ProjectTraceProvider } from "#veryfront/extensions/observability/tracing-exporter.ts";

const storage = new AsyncLocalStorage<ProjectTraceProvider | undefined>();
const getStore = AsyncLocalStorage.prototype.getStore;
const run = AsyncLocalStorage.prototype.run;
const apply = Reflect.apply;
const contextProviders = new WeakMap<object, ProjectTraceProvider>();
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

/** Retain provider ownership only for contexts containing a project span. */
export function rememberProjectContext(
  context: object,
  provider = getProjectTraceProvider(),
): void {
  // SDK root contexts may be shared across providers and must never acquire an owner.
  if (!provider) return;
  const span = provider.getTraceAPI().getSpan(context);
  if (!span || typeof span !== "object") return;
  const owner = getSpanProjectProvider(span) ?? provider;
  if (!apply(weakGet, spanProviders, [span])) apply(weakSet, spanProviders, [span, owner]);
  if (!apply(weakGet, contextProviders, [context])) {
    apply(weakSet, contextProviders, [context, owner]);
  }
}

export function getContextProjectProvider(context: object): ProjectTraceProvider | undefined {
  return apply(weakGet, contextProviders, [context]) as ProjectTraceProvider | undefined;
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
