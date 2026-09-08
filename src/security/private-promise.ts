const PromiseConstructor = Promise;
const apply = Reflect.apply;
const promiseThen = Promise.prototype.then;
const promiseResolve = Promise.resolve;

/** Chain owned lifecycle work without consulting mutable Promise methods. */
export function chainPrivatePromise<T, U>(
  promise: Promise<T>,
  fulfilled: (value: T) => U | PromiseLike<U>,
  rejected?: (reason: unknown) => U | PromiseLike<U>,
): Promise<U> {
  return apply(promiseThen, promise, [fulfilled, rejected]) as Promise<U>;
}

/** Create the initial settled promise for an owned lifecycle chain. */
export function resolvePrivatePromise(): Promise<void> {
  return apply(promiseResolve, PromiseConstructor, []) as Promise<void>;
}
