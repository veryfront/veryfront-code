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
const NativeWeakMap = WeakMap;
const NativeRequest = Request;
const RequestHeadersGetter = Object.getOwnPropertyDescriptor(NativeRequest.prototype, "headers")!
  .get!;
const ArrayIsArray = Array.isArray;
const NativeArray = Array;
const ArrayFrom = Array.from;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectPrototype = Object.prototype;
const SymbolIterator: symbol = Symbol.iterator;
const ObjectCreate = Object.create;
const ObjectHasOwn = Object.hasOwn;
const ObjectKeys = Object.keys;
const NativeString = String;
const StringToLowerCase = String.prototype.toLowerCase;
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
      throw new NativeTypeError(
        `Refused a credential-bearing request to protect its token: ${describeMember(snapshot)} ` +
          "was replaced, and Deno's fetch calls it with the request headers in reach. " +
          "Do not patch Request or Headers members that fetch uses (use msw in tests only).",
      );
    }
  }
}

function describeMember(snapshot: PropertySnapshot): string {
  const owner = snapshot.target === NativeHeaders.prototype ? "Headers" : "Request";
  const key = snapshot.key;
  return typeof key === "symbol"
    ? `${owner}.prototype[${NativeString(key)}]`
    : `${owner}.prototype.${NativeString(key)}`;
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

/**
 * An iterable of pairs other than an array (a Map, a generator) as an array,
 * which the native conversion accepts too. Plain records are left alone: their
 * `Symbol.iterator` would be looked up on `Object.prototype`, where a getter
 * would run with the record, and its headers, as `this`.
 */
function toPairsIfIterable(source: HeadersInit): HeadersInit {
  if (ArrayIsArray(source) || typeof source !== "object" || source === null) return source;
  const prototype = ObjectGetPrototypeOf(source);
  if (prototype === null || prototype === ObjectPrototype) return source;
  const iterator: unknown = (source as Record<symbol, unknown>)[SymbolIterator];
  if (typeof iterator !== "function") return source;
  return IntrinsicReflectApply(ArrayFrom, NativeArray, [source]) as [string, string][];
}

function isNativeHeaders(value: unknown): value is Headers {
  return IntrinsicReflectApply(FunctionHasInstance, NativeHeaders, [value]) as boolean;
}

const SET_COOKIE = "set-cookie";
// Record -> its set-cookie fields, which a one-value-per-name record cannot hold.
const separateSetCookies = new NativeWeakMap<object, string[]>();
const WeakMapGet = NativeWeakMap.prototype.get;
const WeakMapSet = NativeWeakMap.prototype.set;

function keepSetCookieApart(record: Record<string, string>, value: string): void {
  let values = IntrinsicReflectApply(WeakMapGet, separateSetCookies, [record]) as
    | string[]
    | undefined;
  if (values === undefined) {
    // Not a credential, so this list may use ordinary array writes.
    values = [];
    IntrinsicReflectApply(WeakMapSet, separateSetCookies, [record, values]);
  }
  values[values.length] = value;
}

/** The set-cookie fields kept beside `record`, if any. */
export function readSeparateSetCookies(record: unknown): readonly string[] | undefined {
  if (typeof record !== "object" || record === null) return undefined;
  return IntrinsicReflectApply(WeakMapGet, separateSetCookies, [record]) as
    | string[]
    | undefined;
}

function appendSetCookies(headers: Headers, record: unknown): void {
  const values = readSeparateSetCookies(record);
  if (values === undefined) return;
  for (let index = 0; index < values.length; index++) {
    IntrinsicReflectApply(HeadersAppend, headers, [SET_COOKIE, values[index]]);
  }
}

/**
 * The arguments for a native `fetch` of `input` with `init`. Usually the two
 * unchanged; when the init's header record has set-cookie fields beside it,
 * a Request built from the init with each of those appended on its own, and
 * an init carrying only the runtime-specific `client`.
 */
export function nativeFetchArguments(
  input: RequestInfo | URL,
  init: RequestInit,
): [RequestInfo | URL, RequestInit | undefined] {
  const headers = readOwnInitField(init, "headers");
  if (readSeparateSetCookies(headers) === undefined) return [input, init];
  const client = readOwnInitField(init, "client" as never);
  const request = new NativeRequest(input, createNativeRequestInit(init, { client: undefined }));
  appendSetCookies(IntrinsicReflectApply(RequestHeadersGetter, request, []) as Headers, headers);
  return [
    request,
    client === undefined ? undefined : createNativeRequestInit(undefined, { client }),
  ];
}

/** `new Request(input, init)`, with the init record's set-cookie fields kept apart. */
export function createNativeRequest(input: RequestInfo | URL, init: RequestInit): Request {
  const request = new NativeRequest(input, init);
  appendSetCookies(
    IntrinsicReflectApply(RequestHeadersGetter, request, []) as Headers,
    readOwnInitField(init, "headers"),
  );
  return request;
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
  source = toPairsIfIterable(source);
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
  appendSetCookies(headers, record);
  return headers;
}

/**
 * `headers` as a null-prototype record for a native constructor or `fetch`,
 * which then reads it by own key rather than through iteration. `Headers`
 * already joins the values of a repeated name. `set-cookie` fields cannot be
 * joined without corrupting them (`Expires=` dates hold commas), so they stay
 * out of the record and travel beside it (see {@link nativeFetchArguments}).
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
    // Indexed, not destructured: destructuring runs Array.prototype's iterator.
    const name = step.value[0];
    const value = step.value[1];
    if (name === SET_COOKIE) {
      keepSetCookieApart(record, value);
      continue;
    }
    record[name] = IntrinsicReflectApply(ObjectHasOwn, undefined, [record, name])
      ? `${record[name]}, ${value}`
      : value;
  }
}

function appendToRecord(record: Record<string, string>, name: unknown, value: unknown): void {
  const key = IntrinsicReflectApply(StringToLowerCase, NativeString(name), []) as string;
  const text = NativeString(value);
  if (key === SET_COOKIE) {
    keepSetCookieApart(record, text);
    return;
  }
  record[key] = IntrinsicReflectApply(ObjectHasOwn, undefined, [record, key])
    ? `${record[key]}, ${text}`
    : text;
}

/**
 * An array or record header init as a null-prototype record, built without a
 * native `Headers`: filling one pushes onto internal arrays, which a setter on
 * an `Array.prototype` index would observe. The native call validates the
 * names and values when it reads the record.
 */
function toNativeHeaderRecordFromInit(source: HeadersInit): Record<string, string> {
  const record = ObjectCreate(null) as Record<string, string>;
  source = toPairsIfIterable(source);
  if (ArrayIsArray(source)) {
    for (let index = 0; index < source.length; index++) {
      const pair = source[index] as readonly unknown[];
      if (!ArrayIsArray(pair) || pair.length !== 2) {
        throw new TypeError("Header pairs must contain exactly a name and a value");
      }
      appendToRecord(record, pair[0], pair[1]);
    }
    return record;
  }
  const names = ObjectKeys(source);
  for (let index = 0; index < names.length; index++) {
    const name = names[index]!;
    appendToRecord(record, name, (source as Record<string, string>)[name]);
  }
  return record;
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
    const record = isNativeHeaders(headers)
      ? toNativeHeaderRecord(headers)
      : toNativeHeaderRecordFromInit(headers as HeadersInit);
    // A record rebuilt from one that had set-cookie fields beside it keeps them.
    const carried = readSeparateSetCookies(headers);
    if (carried !== undefined) {
      for (let index = 0; index < carried.length; index++) {
        keepSetCookieApart(record, carried[index]!);
      }
    }
    init.headers = record;
  }
  return init as RequestInit;
}
