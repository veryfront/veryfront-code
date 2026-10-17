import { AsyncLocalStorage, AsyncResource } from "node:async_hooks";

// Captured at module evaluation so project code cannot replace them later.
const requestDispatchStorage = new AsyncLocalStorage<true>();
const requestHostContext = new AsyncResource("VeryfrontHttpRequest");
const AsyncResourceRunInAsyncScope = AsyncResource.prototype.runInAsyncScope;
const AsyncLocalStorageRun = AsyncLocalStorage.prototype.run;
const IntrinsicReflectApply = Reflect.apply;

/**
 * Dispatch each request in its own async-context scope.
 *
 * Deno 2.9 runs `Deno.serve()` callbacks in the server loop's own async
 * context, so a store set with `enterWith()` while one request runs persists
 * into every later request. A new request can then inherit another request's
 * logger, trace and run-event stores, including a mandatory run-event sink
 * whose writer capability was already revoked.
 *
 * A dynamic import can also leave Deno's server loop with the importing task's
 * context. Restore the trusted module-initialization context before entering a
 * request so inherited stores cannot cross that boundary. Stores installed by
 * the handler itself remain available for its complete asynchronous lifetime.
 */
export function scopeRequestAsyncContext<Info, R>(
  handler: (request: Request, info?: Info) => R,
): (request: Request, info?: Info) => R {
  // Keep both parameters declared: Deno.serve() passes no request to a
  // handler whose declared arity is zero.
  return (request: Request, info?: Info) =>
    IntrinsicReflectApply(AsyncResourceRunInAsyncScope, requestHostContext, [
      () =>
        IntrinsicReflectApply(AsyncLocalStorageRun, requestDispatchStorage, [
          true,
          () => handler(request, info),
        ]),
      null,
    ]) as R;
}
