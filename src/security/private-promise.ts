const NativePromise = Promise;
const NativePromisePrototype = Promise.prototype;
const apply = Reflect.apply;
const promiseThen = Promise.prototype.then;
const promiseWithResolvers = Promise.withResolvers;
const nativeHasInstance = Function.prototype[Symbol.hasInstance];
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getPrototypeOf = Object.getPrototypeOf;
const hasOwn = Object.hasOwn;
const freeze = Object.freeze;
const species: typeof Symbol.species = Symbol.species;

function isNativePromise(value: unknown): value is Promise<unknown> {
  return apply(nativeHasInstance, NativePromise, [value]) as boolean;
}

function hasObservableConstructor(promise: Promise<unknown>): boolean {
  let current: object | null = promise;
  for (let depth = 0; current !== null && depth < 128; depth++) {
    const descriptor = getOwnPropertyDescriptor(current, "constructor");
    if (descriptor) return current === promise || hasOwn(descriptor, "value");
    if (current === NativePromisePrototype) return false;
    current = getPrototypeOf(current);
  }
  return false;
}

function observeNative(
  promise: Promise<unknown>,
  fulfilled: (value: unknown) => void,
  rejected: (reason: unknown) => void,
): void {
  try {
    // An inherited constructor getter could receive the private promise as its
    // receiver. If native observation cannot be installed, keep ownership
    // pending for the executor's deadline/fence instead of reporting completion.
    if (!hasObservableConstructor(promise)) return;
    // Ignore the species-created return value. Only reactions attached to the
    // original promise may settle the protected wrapper.
    apply(promiseThen, promise, [fulfilled, rejected]);
  } catch {
    // A hostile constructor/species can prevent observation. It cannot turn
    // unfinished work into an observed fulfillment or rejection.
  }
}

function adopt<T>(
  value: unknown,
  resolve: (value: T | PromiseLike<T>) => void,
  reject: (reason: unknown) => void,
): void {
  try {
    if (isNativePromise(value)) {
      observeNative(value, (next) => adopt(next, resolve, reject), reject);
    } else {
      resolve(value as T);
    }
  } catch (error) {
    reject(error);
  }
}

function createChain<T, U>(
  promise: Promise<T>,
  fulfilled?: ((value: T) => U | PromiseLike<U>) | null,
  rejected?: ((reason: unknown) => U | PromiseLike<U>) | null,
): Promise<U> {
  return new PrivatePromise<U>((resolve, reject) => {
    observeNative(promise, (value) => {
      try {
        adopt(fulfilled ? fulfilled(value as T) : value, resolve, reject);
      } catch (error) {
        reject(error);
      }
    }, (reason) => {
      if (!rejected) {
        reject(reason);
        return;
      }
      try {
        adopt(rejected(reason), resolve, reject);
      } catch (error) {
        reject(error);
      }
    });
  });
}

class PrivatePromise<T> extends NativePromise<T> {
  static override get [species](): typeof PrivatePromise {
    return PrivatePromise;
  }

  // This native Promise subclass intentionally implements the Promise protocol.
  // Its override routes await/then through protected reactions rather than mutable hooks.
  override then<F = T, R = never>( // NOSONAR S7739: intentional Promise override, not an accidental thenable.
    fulfilled?: ((value: T) => F | PromiseLike<F>) | null,
    rejected?: ((reason: unknown) => R | PromiseLike<R>) | null,
  ): Promise<F | R> {
    return createChain<T, F | R>(this, fulfilled, rejected);
  }
}
freeze(PrivatePromise.prototype);
freeze(PrivatePromise);

/** Observe owned native work without changing the input promise. */
export function chainPrivatePromise<T, U>(
  promise: Promise<T>,
  fulfilled: (value: T) => U | PromiseLike<U>,
  rejected?: (reason: unknown) => U | PromiseLike<U>,
): Promise<U> {
  return createChain(promise, fulfilled, rejected);
}

/** Join a native operation before exposing its result to a lifecycle await. */
export function observePrivatePromise<T>(promise: Promise<T>): Promise<T> {
  return createChain(promise, (value) => value);
}

/** Create the initial settled promise for an owned lifecycle chain. */
export function resolvePrivatePromise(): Promise<void> {
  return new PrivatePromise<void>((resolve) => resolve());
}

/** Create an owned completion latch without consulting a replaced constructor helper. */
export function createPrivateDeferred<T>(): PromiseWithResolvers<T> {
  return apply(promiseWithResolvers, PrivatePromise, []) as PromiseWithResolvers<T>;
}
