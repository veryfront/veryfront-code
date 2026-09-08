import { observePrivatePromise } from "#veryfront/security/private-promise.ts";

const apply = Reflect.apply;
const freeze = Object.freeze;
const setPrototypeOf = Object.setPrototypeOf;
const isPrototypeOf = Object.prototype.isPrototypeOf;
const asyncIteratorSymbol: typeof Symbol.asyncIterator = Symbol.asyncIterator;
const generatorPrototype = Object.getPrototypeOf(Object.getPrototypeOf((async function* () {})()));
const generatorNext = generatorPrototype.next;
const generatorReturn = generatorPrototype.return;
const generatorThrow = generatorPrototype.throw;

function isNativeGenerator(value: unknown): boolean {
  return apply(isPrototypeOf, generatorPrototype, [value]) as boolean;
}

/** Consume private generators without consulting mutable async-generator methods. */
export function getPrivateAsyncIterator<T>(source: AsyncIterable<T>): AsyncIterableIterator<T> {
  const iterator = isNativeGenerator(source)
    ? source as AsyncIterableIterator<T>
    : source[asyncIteratorSymbol]();
  const native = isNativeGenerator(iterator);
  const next = native ? generatorNext : iterator.next;
  const close = native ? generatorReturn : iterator.return;
  const fail = native ? generatorThrow : iterator.throw;
  const invoke = (method: typeof next, args: unknown[]) =>
    observePrivatePromise(apply(method, iterator, args) as Promise<IteratorResult<T>>);
  const facade: AsyncIterableIterator<T> = {
    next: (...args) => invoke(next, args),
    return: close === undefined ? undefined : (value?: unknown) => invoke(close, [value]),
    throw: fail === undefined ? undefined : (error?: unknown) => invoke(fail, [error]),
    [asyncIteratorSymbol]() {
      return this;
    },
  };
  setPrototypeOf(facade, null);
  return freeze(facade);
}
