import { AsyncLocalStorage } from "node:async_hooks";
import {
  getCurrentRequestContext,
  type RequestContext,
} from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";

const executionContextStorage = new AsyncLocalStorage<Readonly<RequestContext>>();
const apply = Reflect.apply;
const freeze = Object.freeze;
const run = AsyncLocalStorage.prototype.run;
const getStore = AsyncLocalStorage.prototype.getStore;

/** Bind runtime service clients without changing the filesystem's source project. */
export function runWithRuntimeRequestContext<T>(context: RequestContext, fn: () => T): T {
  return apply(run, executionContextStorage, [freeze({ ...context }), fn]) as T;
}

/** Runtime service identity, with the existing request identity for ordinary calls. */
export function getRuntimeRequestContext(): Readonly<RequestContext> | null {
  return apply(getStore, executionContextStorage, []) as Readonly<RequestContext> | undefined ??
    getCurrentRequestContext();
}
