/**
 * Promise operations captured before extension activation mutates the host
 * realm. Shutdown coordination must not consult live Promise constructors,
 * prototype methods, or species hooks after extension code has run.
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
const hasOwnProperty = Object.prototype.hasOwnProperty;
const nativePromiseThen = Promise.prototype.then;
const promiseSpecies = Symbol.species;

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

const safePromiseSpeciesHolder = createObject(null) as Record<PropertyKey, unknown>;
defineProperty(
  safePromiseSpeciesHolder,
  promiseSpecies,
  createDataDescriptor(NativePromise, false, false),
);
freeze(safePromiseSpeciesHolder);

function pinPromiseConstructor<T>(promise: Promise<T>): Promise<T> {
  defineProperty(promise, "constructor", createDataDescriptor(NativePromise));
  return promise;
}

export function createProxyShutdownPromise<T>(
  executor: (
    resolve: (value: T | PromiseLike<T>) => void,
    reject: (reason?: unknown) => void,
  ) => void,
): Promise<T> {
  return pinPromiseConstructor(new NativePromise<T>(executor));
}

export function continueProxyShutdownPromise<T, R>(
  promise: Promise<T>,
  onFulfilled: (value: T) => R,
  onRejected: (reason: unknown) => R,
): Promise<R> {
  const originalConstructor = getOwnPropertyDescriptor(promise, "constructor");
  if (originalConstructor?.configurable === false) {
    throw new NativeTypeError(
      "Cannot safely observe a proxy shutdown Promise with a fixed constructor",
    );
  }

  defineProperty(promise, "constructor", createDataDescriptor(safePromiseSpeciesHolder));
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
      defineProperty(promise, "constructor", clonePropertyDescriptor(originalConstructor));
    }
  }
  return pinPromiseConstructor(continuation);
}

/**
 * Assimilate native Promises through the captured prototype operation. Plain
 * thenables still use the standard Promise resolution procedure because their
 * `then` callback is application-owned by definition.
 */
export function resolveProxyShutdownValue<T>(
  value: T | PromiseLike<T>,
): Promise<T> {
  return createProxyShutdownPromise<T>((resolve, reject) => {
    if ((typeof value === "object" && value !== null) || typeof value === "function") {
      try {
        continueProxyShutdownPromise(
          value as Promise<T>,
          resolve,
          reject,
        );
        return;
      } catch {
        // A non-Promise thenable is assimilated by the intrinsic resolver.
      }
    }
    resolve(value);
  });
}
