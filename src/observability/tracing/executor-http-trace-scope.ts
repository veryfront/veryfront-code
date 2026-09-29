import { AsyncLocalStorage } from "node:async_hooks";
import type { ProjectTraceProvider } from "#veryfront/extensions/observability/tracing-exporter.ts";
import { getProjectTraceProvider } from "./project-trace-scope.ts";

type ExecutorHttpTraceScope = {
  readonly projectId: string;
  readonly environmentId: string;
  readonly provider: ProjectTraceProvider | undefined;
};

const storage = new AsyncLocalStorage<ExecutorHttpTraceScope>();
const run = AsyncLocalStorage.prototype.run;
const getStore = AsyncLocalStorage.prototype.getStore;
const apply = Reflect.apply;

/** Authenticated installation identity, entered only inside the credential-free recorder. */
export function runWithExecutorHttpTraceScope<T>(
  identity: { projectId: string; environmentId: string },
  operation: () => T,
): T {
  return apply(run, storage, [{
    projectId: identity.projectId,
    environmentId: identity.environmentId,
    provider: getProjectTraceProvider(),
  }, operation]) as T;
}

/** Internal request capability. Request headers and project settings cannot select it. */
export function getExecutorHttpTraceScope(): ExecutorHttpTraceScope | undefined {
  return apply(getStore, storage, []) as ExecutorHttpTraceScope | undefined;
}
