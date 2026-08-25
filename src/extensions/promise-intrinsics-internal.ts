/**
 * Captured Promise operations for extension lifecycle boundaries.
 *
 * Extension-owned code runs in the host realm and can mutate public Promise
 * hooks after module initialization. Lifecycle coordination therefore uses
 * captured intrinsics and temporarily shadows each observed Promise's
 * constructor so native `then` cannot consult a mutated constructor or
 * `Symbol.species`. A Promise whose constructor cannot be shadowed is observed
 * only while its complete constructor path still uses the captured intrinsic
 * hooks.
 *
 * @internal
 */

const NativePromise = Promise;
const NativeTypeError = TypeError;
const apply = Reflect.apply;
const createObject = Object.create;
const defineProperty = Object.defineProperty;
const deleteProperty = Reflect.deleteProperty;
const freeze = Object.freeze;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getPrototypeOf = Object.getPrototypeOf;
const hasOwnProperty = Object.prototype.hasOwnProperty;
const isExtensible = Object.isExtensible;
const nativePromiseThen = Promise.prototype.then;
const nativePromisePrototype = Promise.prototype;
const promiseSpecies = Symbol.species;
const nativePromiseSpeciesGetter = getOwnPropertyDescriptor(
  NativePromise,
  promiseSpecies,
)?.get;

const safePromiseSpeciesHolder = createObject(null) as Record<PropertyKey, unknown>;
defineProperty(
  safePromiseSpeciesHolder,
  promiseSpecies,
  createDataDescriptor(NativePromise, false, false),
);
freeze(safePromiseSpeciesHolder);

function hasOwn(object: PropertyDescriptor, key: PropertyKey): boolean {
  return apply(hasOwnProperty, object, [key]) as boolean;
}

function createDataDescriptor(
  value: unknown,
  configurable = true,
  writable = false,
): PropertyDescriptor {
  const descriptor = createObject(null) as PropertyDescriptor;
  descriptor.configurable = configurable;
  descriptor.enumerable = false;
  descriptor.value = value;
  descriptor.writable = writable;
  return descriptor;
}

function clonePropertyDescriptor(descriptor: PropertyDescriptor): PropertyDescriptor {
  const clone = createObject(null) as PropertyDescriptor;
  if (hasOwn(descriptor, "configurable")) clone.configurable = descriptor.configurable;
  if (hasOwn(descriptor, "enumerable")) clone.enumerable = descriptor.enumerable;
  if (hasOwn(descriptor, "get")) clone.get = descriptor.get;
  if (hasOwn(descriptor, "set")) clone.set = descriptor.set;
  if (hasOwn(descriptor, "value")) clone.value = descriptor.value;
  if (hasOwn(descriptor, "writable")) clone.writable = descriptor.writable;
  return clone;
}

function pinPromiseConstructor<T>(promise: Promise<T>): Promise<T> {
  defineProperty(
    promise,
    "constructor",
    createDataDescriptor(NativePromise),
  );
  return promise;
}

function hasVerifiedIntrinsicPromiseSpeciesHook(): boolean {
  const speciesDescriptor = getOwnPropertyDescriptor(
    NativePromise,
    promiseSpecies,
  );
  return typeof nativePromiseSpeciesGetter === "function" &&
    speciesDescriptor !== undefined &&
    hasOwn(speciesDescriptor, "get") &&
    speciesDescriptor.get === nativePromiseSpeciesGetter &&
    speciesDescriptor.set === undefined;
}

function hasVerifiedIntrinsicPromisePrototypeConstructor(): boolean {
  const constructorDescriptor = getOwnPropertyDescriptor(
    nativePromisePrototype,
    "constructor",
  );
  return constructorDescriptor !== undefined &&
    hasOwn(constructorDescriptor, "value") &&
    constructorDescriptor.value === NativePromise;
}

function createContinuationWithVerifiedIntrinsicConstructor<T, R>(
  promise: Promise<T>,
  originalConstructor: PropertyDescriptor | undefined,
  onFulfilled: (value: T) => R,
  onRejected: (reason: unknown) => R,
): Promise<R> {
  const ownsIntrinsicConstructor = originalConstructor !== undefined &&
    hasOwn(originalConstructor, "value") &&
    originalConstructor.value === NativePromise;
  const inheritsIntrinsicConstructor = originalConstructor === undefined &&
    getPrototypeOf(promise) === nativePromisePrototype &&
    hasVerifiedIntrinsicPromisePrototypeConstructor();
  if (
    (!ownsIntrinsicConstructor && !inheritsIntrinsicConstructor) ||
    !hasVerifiedIntrinsicPromiseSpeciesHook()
  ) {
    throw new NativeTypeError(
      "Cannot safely observe a Promise without verified intrinsic constructor hooks",
    );
  }

  const continuation = apply(nativePromiseThen, promise, [
    onFulfilled,
    onRejected,
  ]) as Promise<R>;
  return pinPromiseConstructor(continuation);
}

/**
 * Construct a core-owned Promise whose constructor lookup remains intrinsic.
 *
 * Callers must keep the executor core-owned; this helper is not an isolation
 * boundary for arbitrary thenables passed to `resolve`.
 */
export function createIntrinsicPromise<T>(
  executor: (
    resolve: (value: T | PromiseLike<T>) => void,
    reject: (reason?: unknown) => void,
  ) => void,
): Promise<T> {
  return pinPromiseConstructor(new NativePromise<T>(executor));
}

/** Create an already-fulfilled, constructor-pinned lifecycle Promise. */
export function createResolvedIntrinsicPromise(): Promise<void> {
  return createIntrinsicPromise<void>((resolve) => resolve());
}

/**
 * Attach non-thenable settlement callbacks without consulting live Promise
 * properties. The returned continuation is constructor-pinned for safe await
 * and for subsequent calls to this helper.
 */
export function createIntrinsicPromiseContinuation<T, R>(
  promise: Promise<T>,
  onFulfilled: (value: T) => R,
  onRejected: (reason: unknown) => R,
): Promise<R> {
  const originalConstructor = getOwnPropertyDescriptor(promise, "constructor");
  if (originalConstructor?.configurable === false) {
    if (!hasOwn(originalConstructor, "value")) {
      throw new NativeTypeError(
        "Cannot safely observe a Promise with a fixed constructor",
      );
    }
    return createContinuationWithVerifiedIntrinsicConstructor(
      promise,
      originalConstructor,
      onFulfilled,
      onRejected,
    );
  }

  if (originalConstructor === undefined && !isExtensible(promise)) {
    return createContinuationWithVerifiedIntrinsicConstructor(
      promise,
      originalConstructor,
      onFulfilled,
      onRejected,
    );
  }

  defineProperty(
    promise,
    "constructor",
    createDataDescriptor(safePromiseSpeciesHolder),
  );
  let continuation: Promise<R>;
  try {
    continuation = apply(nativePromiseThen, promise, [
      onFulfilled,
      onRejected,
    ]) as Promise<R>;
  } finally {
    if (originalConstructor === undefined) {
      deleteProperty(promise, "constructor");
    } else {
      defineProperty(
        promise,
        "constructor",
        clonePropertyDescriptor(originalConstructor),
      );
    }
  }
  return pinPromiseConstructor(continuation);
}
