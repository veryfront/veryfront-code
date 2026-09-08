import { defineOwnDataProperty } from "#veryfront/security/own-data-property.ts";

const NativePromise = Promise;
const apply = Reflect.apply;
const promiseThen = Promise.prototype.then;
const promiseResolve = Promise.resolve;
const promiseWithResolvers = Promise.withResolvers;
const nativeHasInstance = Function.prototype[Symbol.hasInstance];
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const hasOwn = Object.hasOwn;
const freeze = Object.freeze;
const species: typeof Symbol.species = Symbol.species;

function isNativePromise(value: unknown): value is Promise<unknown> {
  return apply(nativeHasInstance, NativePromise, [value]) as boolean;
}

function protectResult<T>(value: T): T {
  if (isNativePromise(value)) protectPromise(value);
  return value;
}

class PrivatePromise<T> extends NativePromise<T> {
  static override get [species](): typeof PrivatePromise {
    return PrivatePromise;
  }

  override then<F = T, R = never>(
    fulfilled?: ((value: T) => F | PromiseLike<F>) | null,
    rejected?: ((reason: unknown) => R | PromiseLike<R>) | null,
  ): Promise<F | R> {
    return apply(promiseThen, this, [
      typeof fulfilled === "function" ? (value: T) => protectResult(fulfilled(value)) : fulfilled,
      typeof rejected === "function"
        ? (reason: unknown) => protectResult(rejected(reason))
        : rejected,
    ]) as Promise<F | R>;
  }
}
freeze(PrivatePromise.prototype);
freeze(PrivatePromise);
const privateThen = PrivatePromise.prototype.then;

function protectPromise<T>(promise: Promise<T>): Promise<T> {
  const constructor = getOwnPropertyDescriptor(promise, "constructor");
  if (!constructor || !hasOwn(constructor, "value") || constructor.value !== PrivatePromise) {
    defineOwnDataProperty(promise, "constructor", PrivatePromise);
  }
  const then = getOwnPropertyDescriptor(promise, "then");
  if (!then || !hasOwn(then, "value") || then.value !== privateThen) {
    defineOwnDataProperty(promise, "then", privateThen);
  }
  return promise;
}

/** Observe owned native work through fixed constructor, species, and chaining methods. */
export function chainPrivatePromise<T, U>(
  promise: Promise<T>,
  fulfilled: (value: T) => U | PromiseLike<U>,
  rejected?: (reason: unknown) => U | PromiseLike<U>,
): Promise<U> {
  return apply(privateThen, protectPromise(promise), [fulfilled, rejected]) as Promise<U>;
}

/** Join a native operation before exposing its result to a lifecycle await. */
export function observePrivatePromise<T>(promise: Promise<T>): Promise<T> {
  return chainPrivatePromise(promise, (value) => value);
}

/** Create the initial settled promise for an owned lifecycle chain. */
export function resolvePrivatePromise(): Promise<void> {
  return protectPromise(apply(promiseResolve, NativePromise, []) as Promise<void>);
}

/** Create an owned completion latch without consulting a replaced constructor helper. */
export function createPrivateDeferred<T>(): PromiseWithResolvers<T> {
  const deferred = apply(promiseWithResolvers, NativePromise, []) as PromiseWithResolvers<T>;
  protectPromise(deferred.promise);
  return deferred;
}
