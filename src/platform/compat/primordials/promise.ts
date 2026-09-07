/** Host Promise operations for work that continues after project evaluation. */
import { primordialArraySet } from "./array.ts";

export const IntrinsicPromise = Promise;
export const primordialPromiseResolve = Promise.resolve.bind(Promise);
export const primordialPromiseReject = Promise.reject.bind(Promise);

// Native await does not dispatch a same-realm Promise's mutable then method.
// Capturing finally alone is insufficient: it still reads the receiver's then.
export function primordialPromiseThen<T, R, E = never>(
  promise: Promise<T>,
  fulfilled: (value: T) => R | PromiseLike<R>,
  rejected?: ((error: unknown) => E | PromiseLike<E>) | null,
): Promise<R | E>;
export function primordialPromiseThen<T, E = never>(
  promise: Promise<T>,
  fulfilled?: null,
  rejected?: ((error: unknown) => E | PromiseLike<E>) | null,
): Promise<T | E>;
export async function primordialPromiseThen<T, R, E>(
  promise: Promise<T>,
  fulfilled?: ((value: T) => R | PromiseLike<R>) | null,
  rejected?: ((error: unknown) => E | PromiseLike<E>) | null,
): Promise<T | R | E> {
  let value: T;
  try {
    value = await promise;
  } catch (error) {
    if (rejected) return await rejected(error);
    throw error;
  }
  return fulfilled ? await fulfilled(value) : value;
}

export function primordialPromiseCatch<T, E>(
  promise: Promise<T>,
  rejected: (error: unknown) => E | PromiseLike<E>,
): Promise<T | E> {
  return primordialPromiseThen(promise, undefined, rejected);
}

export async function primordialPromiseFinally<T>(
  promise: Promise<T>,
  settled: () => unknown,
): Promise<T> {
  try {
    return await promise;
  } finally {
    await settled();
  }
}

/** Observe every input immediately, preserving order and fail-fast rejection. */
export function primordialPromiseAll<const T extends readonly unknown[]>(
  values: T,
): Promise<{ -readonly [K in keyof T]: Awaited<T[K]> }>;
export function primordialPromiseAll(values: readonly unknown[]): Promise<unknown[]> {
  return new IntrinsicPromise((resolve, reject) => {
    const results: unknown[] = [];
    let remaining = 1;
    for (let index = 0; index < values.length; index++) {
      const value = values[index];
      remaining++;
      void (async () => {
        try {
          primordialArraySet(results, index, await value);
          if (--remaining === 0) resolve(results);
        } catch (error) {
          reject(error);
        }
      })();
    }
    if (--remaining === 0) resolve(results);
  });
}

export function primordialPromiseAllSettled<T>(
  values: readonly T[],
): Promise<PromiseSettledResult<Awaited<T>>[]> {
  const settled: Promise<PromiseSettledResult<Awaited<T>>>[] = [];
  for (let index = 0; index < values.length; index++) {
    const value = values[index] as T;
    primordialArraySet(
      settled,
      index,
      (async () => {
        try {
          return { status: "fulfilled", value: await value } as const;
        } catch (reason) {
          return { status: "rejected", reason } as const;
        }
      })(),
    );
  }
  return primordialPromiseAll(settled);
}
