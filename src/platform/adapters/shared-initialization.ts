import { createAbortError } from "#veryfront/utils/abort.ts";

const NativeAbortController = AbortController;
const NativePromise = Promise;
const apply = Reflect.apply;
const controllerSignal = Object.getOwnPropertyDescriptor(AbortController.prototype, "signal")!.get!;
const controllerAbort = AbortController.prototype.abort;
const signalAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "aborted")!.get!;
const signalReason = Object.getOwnPropertyDescriptor(AbortSignal.prototype, "reason")!.get!;
const addListener = EventTarget.prototype.addEventListener;
const removeListener = EventTarget.prototype.removeEventListener;
const promiseThen = Promise.prototype.then;

export interface SharedInitialization<T = void> {
  readonly controller: AbortController;
  readonly promise: Promise<T>;
  waiters: number;
  settled: boolean;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal && apply(signalAborted, signal, [])) {
    throw createAbortError(apply(signalReason, signal, []));
  }
}

export function isSharedInitializationAborted(flight: SharedInitialization<unknown>): boolean {
  return apply(signalAborted, apply(controllerSignal, flight.controller, []), []) as boolean;
}

export function cancelSharedInitialization(flight?: SharedInitialization<unknown>): void {
  if (flight && !flight.settled) apply(controllerAbort, flight.controller, []);
}

export function onSharedInitializationSettled(
  flight: SharedInitialization<unknown>,
  callback: () => void,
): void {
  apply(promiseThen, flight.promise, [callback, callback]);
}

export function drainSharedInitialization(
  flight: SharedInitialization<unknown>,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  const drained = apply(promiseThen, flight.promise, [() => {}, () => {}]) as Promise<void>;
  if (!signal) return drained;
  return new NativePromise<void>((resolve, reject) => {
    let settled = false;
    const finish = (operation: () => void) => {
      if (settled) return;
      settled = true;
      apply(removeListener, signal, ["abort", abort]);
      operation();
    };
    const abort = () => {
      finish(() => reject(createAbortError(apply(signalReason, signal, []))));
    };
    apply(addListener, signal, ["abort", abort, { once: true }]);
    if (apply(signalAborted, signal, [])) {
      abort();
      return;
    }
    apply(promiseThen, drained, [
      () => finish(resolve),
      () => finish(resolve),
    ]);
  });
}

export function startSharedInitialization<T>(
  operation: (signal: AbortSignal) => Promise<T>,
): SharedInitialization<T> {
  const controller = new NativeAbortController();
  const flight = {
    controller,
    promise: operation(apply(controllerSignal, controller, []) as AbortSignal),
    waiters: 0,
    settled: false,
  };
  const settled = () => {
    flight.settled = true;
  };
  apply(promiseThen, flight.promise, [settled, settled]);
  return flight;
}

/** Cancel callers promptly; the owner retains the physical flight until settlement. */
export async function joinSharedInitialization<T>(
  flight: SharedInitialization<T>,
  signal?: AbortSignal,
): Promise<T> {
  throwIfAborted(signal);
  flight.waiters++;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    flight.waiters--;
    if (flight.waiters === 0) cancelSharedInitialization(flight);
  };
  let abort: (() => void) | undefined;
  const result = signal
    ? new NativePromise<T>((resolve, reject) => {
      abort = () => {
        release();
        reject(createAbortError(apply(signalReason, signal, [])));
      };
      apply(addListener, signal, ["abort", abort, { once: true }]);
      if (apply(signalAborted, signal, [])) abort();
      apply(promiseThen, flight.promise, [resolve, reject]);
    })
    : flight.promise;
  try {
    return await result;
  } finally {
    if (signal && abort) apply(removeListener, signal, ["abort", abort]);
    release();
  }
}
