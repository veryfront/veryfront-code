/**************************
 * Request Context Store
 *
 * Uses AsyncLocalStorage to propagate request-scoped logger context
 * throughout the call stack without explicit parameter passing.
 *
 * @module utils/logger/request-context
 **************************/

import { AsyncLocalStorage } from "node:async_hooks";
import { __registerRequestContextGetter, type Logger } from "./logger.ts";

export interface RequestContext {
  logger: Logger;
  requestId: string;
  projectSlug?: string;
  projectId?: string;
  domain?: string;
}

export const requestContextStore = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return requestContextStore.getStore();
}

export function getRequestLogger(): Logger | undefined {
  return getRequestContext()?.logger;
}

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return requestContextStore.run(context, fn);
}

export function runWithRequestContextAsync<T>(
  context: RequestContext,
  fn: () => Promise<T>,
): Promise<T> {
  return requestContextStore.run(context, fn);
}

// Register the context getter with the logger module.
// This allows context-aware loggers to access request context
// without creating a circular dependency.
__registerRequestContextGetter(getRequestContext);
