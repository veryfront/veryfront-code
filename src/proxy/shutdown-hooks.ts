// The CLI loads this module before activating extensions. Evaluate the cleanup
// runner now as well so both boundaries capture host intrinsics before any
// extension code can replace them.
import "./shutdown-lifecycle.ts";
import {
  continueProxyShutdownPromise,
  createProxyShutdownPromise,
  resolveProxyShutdownValue,
} from "./shutdown-intrinsics.ts";

export type ProxyShutdownHook = () => void | PromiseLike<void>;
export type RegisterProxyShutdownHook = (hook: ProxyShutdownHook) => () => void;

export interface ProxyShutdownHooks {
  register: RegisterProxyShutdownHook;
  settle: () => Promise<readonly unknown[]>;
  settleOrThrow: () => Promise<void>;
}

const NativeAggregateError = AggregateError;
const NativeError = Error;
const NativeMap = Map;
const NativeTypeError = TypeError;
const apply = Reflect.apply;
const arrayIteratorSymbol: typeof Symbol.iterator = Symbol.iterator;
const createObject = Object.create;
const defineProperty = Object.defineProperty;
const freeze = Object.freeze;
const hasOwnProperty = Object.prototype.hasOwnProperty;
const mapClear = Map.prototype.clear;
const mapDelete = Map.prototype.delete;
const mapForEach = Map.prototype.forEach;
const mapSet = Map.prototype.set;
const scheduleMicrotask = queueMicrotask;

function appendArrayValue<T>(array: T[], value: T): void {
  const descriptor = createObject(null) as PropertyDescriptor;
  descriptor.configurable = true;
  descriptor.enumerable = true;
  descriptor.value = value;
  descriptor.writable = true;
  defineProperty(array, array.length, descriptor);
}

function defineOwnDataProperty(
  object: Record<PropertyKey, unknown>,
  key: PropertyKey,
  value: unknown,
): void {
  const descriptor = createObject(null) as PropertyDescriptor;
  descriptor.configurable = false;
  descriptor.enumerable = false;
  descriptor.value = value;
  descriptor.writable = false;
  defineProperty(object, key, descriptor);
}

/** Build an aggregate without consulting mutable Array iterator prototypes. */
export function createProxyShutdownAggregateError(
  failures: readonly unknown[],
  message: string,
): AggregateError {
  const iterable = createObject(null) as Record<PropertyKey, unknown> & Iterable<unknown>;
  defineOwnDataProperty(iterable, arrayIteratorSymbol, () => {
    let index = 0;
    const iterator = createObject(null) as Record<PropertyKey, unknown>;
    defineOwnDataProperty(iterator, "next", () => {
      const result = createObject(null) as Record<PropertyKey, unknown>;
      const done = index >= failures.length;
      defineOwnDataProperty(result, "done", done);
      if (!done) {
        defineOwnDataProperty(result, "value", failures[index]);
        index++;
      }
      return result;
    });
    return iterator;
  });
  return new NativeAggregateError(
    iterable,
    message,
  );
}

function createHookAggregateError(failures: readonly unknown[]): AggregateError {
  return createProxyShutdownAggregateError(
    failures,
    "Proxy extension owner teardown failed",
  );
}

function defineArrayValue<T>(array: T[], index: number, value: T): void {
  const descriptor = createObject(null) as PropertyDescriptor;
  descriptor.configurable = true;
  descriptor.enumerable = true;
  descriptor.value = value;
  descriptor.writable = true;
  defineProperty(array, index, descriptor);
}

function hasOwn(object: readonly unknown[], key: PropertyKey): boolean {
  return apply(hasOwnProperty, object, [key]) as boolean;
}

function settlePendingHooks(
  pending: readonly ProxyShutdownHook[],
): Promise<readonly unknown[]> {
  return createProxyShutdownPromise<readonly unknown[]>((resolve, reject) => {
    scheduleMicrotask(() => {
      try {
        const failureByIndex: unknown[] = [];
        let remaining = pending.length;
        if (remaining === 0) {
          resolve(freeze([]));
          return;
        }

        const finish = (): void => {
          remaining--;
          if (remaining !== 0) return;
          const failures: unknown[] = [];
          for (let index = 0; index < pending.length; index++) {
            if (hasOwn(failureByIndex, index)) {
              appendArrayValue(failures, failureByIndex[index]);
            }
          }
          resolve(freeze(failures));
        };

        for (let index = 0; index < pending.length; index++) {
          let operation: Promise<void>;
          try {
            operation = resolveProxyShutdownValue(pending[index]!());
          } catch (error) {
            operation = createProxyShutdownPromise<void>((_resolveHook, rejectHook) => {
              rejectHook(error);
            });
          }
          continueProxyShutdownPromise(
            operation,
            finish,
            (error) => {
              defineArrayValue(failureByIndex, index, error);
              finish();
            },
          );
        }
      } catch (error) {
        reject(error);
      }
    });
  });
}

/**
 * Coordinate owner-provided teardown without coupling the proxy runtime to a
 * concrete extension implementation.
 */
export function createProxyShutdownHooks(): ProxyShutdownHooks {
  const hooks = new NativeMap<object, ProxyShutdownHook>();
  let settlement: Promise<readonly unknown[]> | null = null;

  const register: RegisterProxyShutdownHook = (hook) => {
    if (typeof hook !== "function") {
      throw new NativeTypeError("Proxy shutdown hook must be a function");
    }
    if (settlement) {
      throw new NativeError("Proxy shutdown has already started");
    }

    const registration = freeze(createObject(null));
    apply(mapSet, hooks, [registration, hook]);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      apply(mapDelete, hooks, [registration]);
    };
  };

  const settle = (): Promise<readonly unknown[]> => {
    if (settlement) return settlement;
    const pending: ProxyShutdownHook[] = [];
    apply(mapForEach, hooks, [
      (hook: ProxyShutdownHook) => appendArrayValue(pending, hook),
    ]);
    apply(mapClear, hooks, []);
    settlement = settlePendingHooks(pending);
    return settlement;
  };

  const settleOrThrow = (): Promise<void> => {
    const pendingSettlement = settle();
    return createProxyShutdownPromise<void>((resolve, reject) => {
      try {
        continueProxyShutdownPromise(
          pendingSettlement,
          (failures) => {
            try {
              if (failures.length > 0) {
                reject(createHookAggregateError(failures));
                return;
              }
              resolve();
            } catch (error) {
              reject(error);
            }
          },
          reject,
        );
      } catch (error) {
        reject(error);
      }
    });
  };

  return freeze({ register, settle, settleOrThrow });
}

const processProxyShutdownHooks = createProxyShutdownHooks();

export const registerProxyShutdownHook = processProxyShutdownHooks.register;
export const settleProxyShutdownHooks = processProxyShutdownHooks.settle;
export const settleProxyShutdownHooksOrThrow = processProxyShutdownHooks.settleOrThrow;
