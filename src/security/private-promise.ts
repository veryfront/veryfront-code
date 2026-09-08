const PromiseConstructor = Promise;
const apply = Reflect.apply;
const promiseResolve = Promise.resolve;

/** Await owned native promises without dispatching through replaced promise methods. */
export async function chainPrivatePromise<T, U>(
  promise: Promise<T>,
  fulfilled: (value: T) => U | PromiseLike<U>,
  rejected?: (reason: unknown) => U | PromiseLike<U>,
): Promise<U> {
  let value: T;
  try {
    value = await promise;
  } catch (error) {
    if (rejected) return await rejected(error);
    throw error;
  }
  return await fulfilled(value);
}

/** Create the initial settled promise for an owned lifecycle chain. */
export function resolvePrivatePromise(): Promise<void> {
  return apply(promiseResolve, PromiseConstructor, []) as Promise<void>;
}
