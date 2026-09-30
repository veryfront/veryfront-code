/**
 * Locks the symbol-keyed internals of `Request.prototype` and
 * `Headers.prototype` so project code cannot replace them.
 *
 * Deno keeps a request's headers and a header list behind symbol-keyed
 * members on these prototypes (`Symbol(headers)`, `Symbol(iterable headers)`)
 * and reaches them through the live prototype, even from the accessors the
 * framework captures at load. `Object.getOwnPropertySymbols` exposes those
 * keys, so a replacement installed by project code would run with the
 * request or headers as `this` on every framework read, captured or not.
 * Nothing legitimate replaces these internals, so they are made
 * non-configurable (and data members non-writable) once, before project code
 * runs; public members such as `get` or `has` are left alone.
 *
 * @module platform/compat/http/native-request-internals
 */

const ObjectDefineProperty = Object.defineProperty;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectGetOwnPropertySymbols = Object.getOwnPropertySymbols;
const WELL_KNOWN_SYMBOLS: readonly symbol[] = [Symbol.iterator, Symbol.toStringTag];

let locked = false;

function lockSymbolMembers(target: typeof Request.prototype | typeof Headers.prototype): void {
  const keys = ObjectGetOwnPropertySymbols(target);
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]!;
    if (WELL_KNOWN_SYMBOLS.includes(key)) continue;
    const descriptor = ObjectGetOwnPropertyDescriptor(target, key);
    if (!descriptor?.configurable) continue;
    ObjectDefineProperty(
      target,
      key,
      "value" in descriptor ? { configurable: false, writable: false } : { configurable: false },
    );
  }
}

/** Lock the internals once; later calls are no-ops. */
export function lockNativeRequestInternals(): void {
  if (locked) return;
  locked = true;
  lockSymbolMembers(Request.prototype);
  lockSymbolMembers(Headers.prototype);
}
