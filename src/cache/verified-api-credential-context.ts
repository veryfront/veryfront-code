import { AsyncLocalStorage } from "node:async_hooks";
import {
  consumeVerifiedControlPlaneCacheCredential,
  type VerifiedControlPlaneCacheCredential,
  type VerifiedControlPlaneRequestClaims,
} from "#veryfront/internal-agents/control-plane-auth.ts";

interface VerifiedCredentialScope {
  credential: VerifiedControlPlaneCacheCredential | undefined;
  callbackSettled: boolean;
  active: boolean;
  responseLeases: number;
}

const verifiedCredentialStorage = new AsyncLocalStorage<
  VerifiedCredentialScope | null
>();

const AsyncLocalStoragePrototypeGetStore = AsyncLocalStorage.prototype.getStore;
const AsyncLocalStoragePrototypeRun = AsyncLocalStorage.prototype.run;
const IntrinsicPromise = Promise;
const IntrinsicReadableStream = ReadableStream;
const IntrinsicResponse = Response;
const MaxSafeInteger = Number.MAX_SAFE_INTEGER;
const PromisePrototypeThen = Promise.prototype.then;
const PromiseResolve = Promise.resolve;
const ReflectApply = Reflect.apply;

function getScope(): VerifiedCredentialScope | null | undefined {
  return ReflectApply(
    AsyncLocalStoragePrototypeGetStore,
    verifiedCredentialStorage,
    [],
  );
}

function runInScope<T>(
  scope: VerifiedCredentialScope | null,
  fn: () => T,
): T {
  return ReflectApply(
    AsyncLocalStoragePrototypeRun,
    verifiedCredentialStorage,
    [scope, fn],
  ) as T;
}

function revokeScopeIfComplete(scope: VerifiedCredentialScope): void {
  if (!scope.callbackSettled || scope.responseLeases !== 0) return;
  scope.active = false;
  scope.credential = undefined;
}

function settleCallback(scope: VerifiedCredentialScope): void {
  scope.callbackSettled = true;
  revokeScopeIfComplete(scope);
}

function releaseResponseLease(scope: VerifiedCredentialScope): void {
  if (scope.responseLeases <= 0) return;
  scope.responseLeases -= 1;
  revokeScopeIfComplete(scope);
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" && value !== null) ||
    typeof value === "function"
  ) &&
    typeof (value as { then?: unknown }).then === "function";
}

/**
 * Runs framework work with the exact cache API credential from a verified
 * control-plane request body. The credential is revoked as soon as the
 * callback settles, including in async descendants detached by the callback.
 *
 * Streaming responses must explicitly retain the credential with
 * `leaseVerifiedCacheApiCredentialResponse`.
 *
 * Keep this helper on internal import surfaces.
 */
export function runWithVerifiedCacheApiCredential<T>(
  claims: VerifiedControlPlaneRequestClaims,
  fn: () => T,
): T {
  const credential = consumeVerifiedControlPlaneCacheCredential(claims);
  if (!credential) return runInScope(null, fn);

  const scope: VerifiedCredentialScope = {
    credential,
    callbackSettled: false,
    active: true,
    responseLeases: 0,
  };

  let result: T;
  try {
    result = runInScope(scope, fn);
  } catch (error) {
    settleCallback(scope);
    throw error;
  }

  let promiseLike: boolean;
  try {
    promiseLike = isPromiseLike(result);
  } catch (error) {
    settleCallback(scope);
    throw error;
  }

  if (!promiseLike) {
    settleCallback(scope);
    return result;
  }

  const promise = ReflectApply(PromiseResolve, IntrinsicPromise, [result]) as Promise<unknown>;
  return ReflectApply(PromisePrototypeThen, promise, [
    (value: unknown) => {
      settleCallback(scope);
      return value;
    },
    (error: unknown) => {
      settleCallback(scope);
      throw error;
    },
  ]) as T;
}

/**
 * Keeps the current verified cache credential alive for one response body.
 *
 * The returned body owns the lease and releases it when the body closes,
 * errors, or is cancelled. Responses without a body need no lease.
 */
export function leaseVerifiedCacheApiCredentialResponse(
  response: Response,
): Response {
  const scope = getScope();
  const source = response.body;
  if (!scope?.active || !scope.credential || !source) return response;
  if (source.locked) {
    throw new TypeError(
      "Cannot lease a verified cache credential to a locked response body",
    );
  }
  if (scope.responseLeases >= MaxSafeInteger) {
    throw new RangeError("Verified cache credential response lease limit exceeded");
  }

  const reader = source.getReader();
  scope.responseLeases += 1;
  let released = false;

  const release = (): void => {
    if (released) return;
    released = true;
    try {
      reader.releaseLock();
    } finally {
      releaseResponseLease(scope);
    }
  };

  try {
    const body = new IntrinsicReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const result = await runInScope(scope, () => reader.read());
          if (result.done) {
            controller.close();
            release();
            return;
          }
          controller.enqueue(result.value);
        } catch (error) {
          try {
            controller.error(error);
          } finally {
            release();
          }
        }
      },
      async cancel(reason) {
        try {
          await runInScope(scope, () => reader.cancel(reason));
        } finally {
          release();
        }
      },
    });

    return new IntrinsicResponse(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (error) {
    release();
    throw error;
  }
}

export function getVerifiedCacheApiCredential():
  | VerifiedControlPlaneCacheCredential
  | undefined {
  const scope = getScope();
  return scope?.active ? scope.credential : undefined;
}
