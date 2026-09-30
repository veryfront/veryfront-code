/**
 * Request inits and header lists for credential-bearing outbound requests,
 * built only from primitives captured when this module loads.
 *
 * Project code can share the isolate with framework egress. Two native paths
 * would otherwise hand it an outgoing `Authorization` value:
 *
 * - A `Headers` object, or an array, given to `new Headers()`,
 *   `new Request()` or `fetch()` is read through a patchable
 *   `Symbol.iterator` and iterator `next`.
 * - `new Request(url, init)` and `fetch(url, init)` read `body`, `client`,
 *   `method`, `redirect`, `signal` and the other init fields by name. In Deno
 *   2.7.7 a field the init lacks is looked up on `Object.prototype`, and a
 *   getter there runs with the init, and its `headers`, as `this`.
 *
 * So outbound code keeps headers in a native `Headers` it only touches through
 * captured methods, and hands the native call a null-prototype record inside a
 * null-prototype init that has every field as its own property.
 *
 * @module platform/compat/http/native-request-init
 */

import { lockNativeRequestInternals } from "./native-request-internals.ts";

const IntrinsicReflectApply = Reflect.apply;
const NativeHeaders = Headers;
const ArrayIsArray = Array.isArray;
const ObjectCreate = Object.create;
const ObjectHasOwn = Object.hasOwn;
const ObjectKeys = Object.keys;
const NativeString = String;
const HeadersAppend = NativeHeaders.prototype.append;
const HeadersEntries = NativeHeaders.prototype.entries;
const HeadersIteratorNext = Object.getPrototypeOf(new NativeHeaders().entries()).next as (
  this: IterableIterator<[string, string]>,
) => IteratorResult<[string, string]>;
const FunctionHasInstance = Function.prototype[Symbol.hasInstance];
const ReflectOwnKeys = Reflect.ownKeys;
const GetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const NativeTypeError = TypeError;

// The captured accessors below still reach headers through these internals.
lockNativeRequestInternals();

type CheckedPrototype = typeof Request.prototype | typeof Headers.prototype;

interface PropertySnapshot {
  readonly target: CheckedPrototype;
  readonly key: PropertyKey;
  readonly descriptor: PropertyDescriptor | undefined;
}

function snapshotProperty(target: CheckedPrototype, key: PropertyKey): PropertySnapshot {
  return { target, key, descriptor: GetOwnPropertyDescriptor(target, key) };
}

/**
 * What Deno 2.7.7's own `Request` constructor and `fetch` call on the request
 * they build, with its headers in reach: `Request.prototype`'s `headers` and
 * `signal` accessors and its symbol-keyed internals, `Headers.prototype`'s
 * symbol-keyed internals (the header list), `has` (fetch checks `Accept` and
 * `Accept-Language`) and `append` (a body adds its content type). The canary
 * in `tests/integration/security/native-fetch-processing.test.ts` fails if a
 * native call starts using anything else.
 */
const NATIVE_REQUEST_PROPERTIES: readonly PropertySnapshot[] = (() => {
  const snapshots: PropertySnapshot[] = [];
  const addInternals = (target: CheckedPrototype) => {
    const keys = ReflectOwnKeys(target);
    for (let index = 0; index < keys.length; index++) {
      const key = keys[index]!;
      if (typeof key === "symbol" && key !== Symbol.iterator && key !== Symbol.toStringTag) {
        snapshots[snapshots.length] = snapshotProperty(target, key);
      }
    }
  };
  addInternals(Request.prototype);
  snapshots[snapshots.length] = snapshotProperty(Request.prototype, "headers");
  snapshots[snapshots.length] = snapshotProperty(Request.prototype, "signal");
  addInternals(NativeHeaders.prototype);
  snapshots[snapshots.length] = snapshotProperty(NativeHeaders.prototype, "has");
  snapshots[snapshots.length] = snapshotProperty(NativeHeaders.prototype, "append");
  return Object.freeze(snapshots);
})();

function isSameDescriptor(
  current: PropertyDescriptor | undefined,
  original: PropertyDescriptor | undefined,
): boolean {
  if (current === undefined || original === undefined) return current === original;
  return current.value === original.value && current.get === original.get &&
    current.set === original.set;
}

/**
 * Refuse to build or send a credential-bearing request once project code has
 * replaced anything the native `Request` or `fetch` calls with the request in
 * reach. Deno calls those through the live prototypes, so no init shape keeps
 * a replacement from seeing the headers; failing the request is the only
 * safe answer.
 */
export function assertNativeRequestProcessing(): void {
  for (let index = 0; index < NATIVE_REQUEST_PROPERTIES.length; index++) {
    const snapshot = NATIVE_REQUEST_PROPERTIES[index]!;
    if (
      !isSameDescriptor(
        GetOwnPropertyDescriptor(snapshot.target, snapshot.key),
        snapshot.descriptor,
      )
    ) {
      throw new NativeTypeError("Cannot send credentials with modified native request processing");
    }
  }
}

/** Every `RequestInit` field Deno, Node (undici) or Bun reads by name. */
export const NATIVE_REQUEST_INIT_FIELDS = Object.freeze(
  [
    "body",
    "cache",
    "client",
    "credentials",
    "dispatcher",
    "duplex",
    "headers",
    "integrity",
    "keepalive",
    "method",
    "mode",
    "priority",
    "redirect",
    "referrer",
    "referrerPolicy",
    "signal",
    "window",
  ] as const,
);

export type NativeRequestInitField = typeof NATIVE_REQUEST_INIT_FIELDS[number];

function isNativeRequestInitField(name: string): boolean {
  for (let index = 0; index < NATIVE_REQUEST_INIT_FIELDS.length; index++) {
    if (NATIVE_REQUEST_INIT_FIELDS[index] === name) return true;
  }
  return false;
}

/** Only what `init` itself holds for `field`; never an inherited value. */
export function readOwnInitField<K extends NativeRequestInitField>(
  init: RequestInit | undefined | null,
  field: K,
): (RequestInit & Record<NativeRequestInitField, unknown>)[K] | undefined {
  if (init === undefined || init === null) return undefined;
  return IntrinsicReflectApply(ObjectHasOwn, undefined, [init, field])
    ? (init as RequestInit & Record<NativeRequestInitField, unknown>)[field]
    : undefined;
}

function isNativeHeaders(value: unknown): value is Headers {
  return IntrinsicReflectApply(FunctionHasInstance, NativeHeaders, [value]) as boolean;
}

/**
 * A native `Headers` holding `source`, copied without running anything
 * project code can replace. A `Headers` source is read with captured
 * iteration, an array by index, and a record by its own keys.
 */
export function copyNativeHeaders(source: HeadersInit | undefined | null): Headers {
  const headers = new NativeHeaders();
  if (source === undefined || source === null) return headers;
  if (isNativeHeaders(source)) {
    const iterator = IntrinsicReflectApply(HeadersEntries, source, []) as IterableIterator<
      [string, string]
    >;
    while (true) {
      const step = IntrinsicReflectApply(HeadersIteratorNext, iterator, []) as IteratorResult<
        [string, string]
      >;
      if (step.done) return headers;
      IntrinsicReflectApply(HeadersAppend, headers, [step.value[0], step.value[1]]);
    }
  }
  if (ArrayIsArray(source)) {
    for (let index = 0; index < source.length; index++) {
      const pair = source[index] as readonly unknown[];
      if (!ArrayIsArray(pair) || pair.length !== 2) {
        throw new TypeError("Header pairs must contain exactly a name and a value");
      }
      IntrinsicReflectApply(HeadersAppend, headers, [
        NativeString(pair[0]),
        NativeString(pair[1]),
      ]);
    }
    return headers;
  }
  const record = source as Record<string, string>;
  const names = ObjectKeys(record);
  for (let index = 0; index < names.length; index++) {
    const name = names[index]!;
    IntrinsicReflectApply(HeadersAppend, headers, [name, NativeString(record[name])]);
  }
  return headers;
}

/**
 * `headers` as a null-prototype record for a native constructor or `fetch`,
 * which then reads it by own key rather than through iteration. `Headers`
 * already joins the values of a repeated name, except `set-cookie`, whose
 * entries it keeps apart; a record holds one value per name, so those are
 * joined here the way `Headers.get("set-cookie")` reports them rather than
 * dropped. A request has no other use for several `Set-Cookie` lines.
 */
export function toNativeHeaderRecord(headers: Headers): Record<string, string> {
  const record = ObjectCreate(null) as Record<string, string>;
  const iterator = IntrinsicReflectApply(HeadersEntries, headers, []) as IterableIterator<
    [string, string]
  >;
  while (true) {
    const step = IntrinsicReflectApply(HeadersIteratorNext, iterator, []) as IteratorResult<
      [string, string]
    >;
    if (step.done) return record;
    const [name, value] = step.value;
    record[name] = IntrinsicReflectApply(ObjectHasOwn, undefined, [record, name])
      ? `${record[name]}, ${value}`
      : value;
  }
}

/**
 * A null-prototype init with every native field as an own property: the own
 * fields of `base` (non-enumerable ones included), then `fields` on top, and
 * `undefined` for the rest. The
 * headers become a null-prototype record, so the native call never iterates
 * them. Own `undefined` fields also survive a later `{ ...init }` spread, which
 * would otherwise produce an ordinary object that inherits them again.
 */
export function createNativeRequestInit(
  base: RequestInit | undefined | null,
  fields: RequestInit & Record<string, unknown> = {},
): RequestInit {
  const init = ObjectCreate(null) as Record<string, unknown>;
  for (let index = 0; index < NATIVE_REQUEST_INIT_FIELDS.length; index++) {
    // Own fields of `base`, enumerable or not, as the native conversion reads
    // them; nothing inherited.
    const field = NATIVE_REQUEST_INIT_FIELDS[index]!;
    init[field] = readOwnInitField(base, field);
  }
  if (base !== undefined && base !== null) {
    // Runtime-specific extras the list does not name. Named fields were read
    // above; reading an accessor twice could yield a different value.
    const names = ObjectKeys(base);
    for (let index = 0; index < names.length; index++) {
      const name = names[index]!;
      if (isNativeRequestInitField(name)) continue;
      init[name] = (base as Record<string, unknown>)[name];
    }
  }
  const overrides = ObjectKeys(fields);
  for (let index = 0; index < overrides.length; index++) {
    const name = overrides[index]!;
    init[name] = fields[name];
  }
  const headers = init.headers;
  if (headers !== undefined && headers !== null) {
    // Even an ordinary record is rebuilt: the native conversion first looks up
    // its `Symbol.iterator`, which an ordinary object inherits.
    init.headers = toNativeHeaderRecord(
      isNativeHeaders(headers) ? headers : copyNativeHeaders(headers as HeadersInit),
    );
  }
  return init as RequestInit;
}
