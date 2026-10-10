import { isNode } from "#veryfront/platform/compat/runtime.ts";

const GetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const HasOwn = Object.hasOwn;
const NativeTypeError = TypeError;
const ObjectPrototype = Object.prototype;
const GetOwnPropertyNames = Object.getOwnPropertyNames;
const GetPrototypeOf = Object.getPrototypeOf;

/** The Node `Buffer` function, read through its `prototype` binding. */
interface NodeBufferBinding {
  prototype: Uint8Array;
}

const NodeBuffer = isNode ? Reflect.get(globalThis, "Buffer") as NodeBufferBinding : undefined;

/** Intrinsic prototypes that body values and native body steps inherit from. */
type BodyPrototype =
  | typeof ObjectPrototype
  | unknown[]
  | Uint8Array
  | Promise<unknown>
  | ArrayBuffer
  | DataView
  | ReadableStream
  | ReadableStreamDefaultReader
  | ReadableStreamDefaultController
  | ReadableByteStreamController;

type BodyPrototypeLink = readonly [
  prototype: BodyPrototype,
  parent: BodyPrototype | null,
  name: string,
];

function linkOf(prototype: BodyPrototype, name: string): BodyPrototypeLink {
  return [prototype, GetPrototypeOf(prototype) as BodyPrototype | null, name];
}

/** Each body prototype with the parent it had when this module loaded. */
const BodyPrototypeLinks: readonly BodyPrototypeLink[] = [
  linkOf(ObjectPrototype, "Object.prototype"),
  linkOf(Array.prototype, "Array.prototype"),
  linkOf(GetPrototypeOf(Uint8Array.prototype) as Uint8Array, "TypedArray.prototype"),
  linkOf(Uint8Array.prototype, "Uint8Array.prototype"),
  linkOf(Promise.prototype, "Promise.prototype"),
  linkOf(ArrayBuffer.prototype, "ArrayBuffer.prototype"),
  linkOf(DataView.prototype, "DataView.prototype"),
  linkOf(ReadableStream.prototype, "ReadableStream.prototype"),
  linkOf(ReadableStreamDefaultReader.prototype, "ReadableStreamDefaultReader.prototype"),
  linkOf(ReadableStreamDefaultController.prototype, "ReadableStreamDefaultController.prototype"),
  ...(typeof globalThis.ReadableByteStreamController === "function"
    ? [linkOf(ReadableByteStreamController.prototype, "ReadableByteStreamController.prototype")]
    : []),
  ...(NodeBuffer ? [linkOf(NodeBuffer.prototype, "Buffer.prototype")] : []),
];

/** The first own property of `owner` whose name is made only of decimal digits. */
function ownIndexProperty(owner: BodyPrototype): string | undefined {
  const names = GetOwnPropertyNames(owner);
  for (let index = 0; index < names.length; index++) { // NOSONAR: Avoid mutable iterator hooks.
    const name = names[index]!;
    let digits = name.length > 0;
    for (let offset = 0; digits && offset < name.length; offset++) {
      digits = name[offset]! >= "0" && name[offset]! <= "9";
    }
    if (digits) return name;
  }
  return undefined;
}

/** Shared prototypes and namespaces whose members native body processing reads. */
type BodyDependencyOwner =
  | ReadableStream
  | ReadableStreamDefaultReader
  | ReadableStreamDefaultController
  | ReadableByteStreamController
  | unknown[]
  | Promise<unknown>
  | TextDecoder
  | TextEncoder
  | JSON
  | Uint8Array
  | ArrayBuffer
  | ArrayBufferConstructor
  | Uint8ArrayConstructor
  | NodeBufferBinding;

/** `absent` members must stay undefined; the others must keep the captured value or getter. */
type BodyDependencyKind = "value" | "get" | "absent";

type BodyDependency = readonly [
  target: BodyDependencyOwner,
  key: PropertyKey,
  kind: BodyDependencyKind,
  captured: unknown,
  /** The member named in rejection errors, for example `Promise.prototype.then`. */
  member: string,
];

function captureMembers(
  target: BodyDependencyOwner,
  owner: string,
  keys: readonly PropertyKey[],
  kind: BodyDependencyKind = "value",
): BodyDependency[] {
  const captured: BodyDependency[] = [];
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]!;
    const descriptor = GetOwnPropertyDescriptor(target, key);
    const member = typeof key === "symbol" ? `${owner}[${String(key)}]` : `${owner}.${key}`;
    captured[index] = [
      target,
      key,
      kind,
      kind === "absent" ? undefined : descriptor?.[kind],
      member,
    ];
  }
  return captured;
}

function dependencyHolds(dependency: BodyDependency): boolean {
  const descriptor = GetOwnPropertyDescriptor(dependency[0], dependency[1]);
  if (dependency[2] === "absent") return descriptor === undefined;
  return !!descriptor && HasOwn(descriptor, dependency[2]) &&
    descriptor[dependency[2]] === dependency[3];
}

const TypedArrayPrototype = GetPrototypeOf(Uint8Array.prototype) as Uint8Array;
const TypedArrayConstructor = GetPrototypeOf(Uint8Array) as Uint8ArrayConstructor;
const ViewAccessors = ["buffer", "byteOffset", "byteLength", "length"] as const;

/**
 * Members that typed array views and array buffers resolve while body bytes are
 * cloned, copied or wrapped, on every runtime.
 */
const BodyDependencies: readonly BodyDependency[] = [
  ...captureMembers(ArrayBuffer.prototype, "ArrayBuffer.prototype", ["constructor", "slice"]),
  ...captureMembers(ArrayBuffer, "ArrayBuffer", [Symbol.species], "get"),
  ...captureMembers(TypedArrayConstructor, "TypedArray", [Symbol.species], "get"),
  ...captureMembers(TypedArrayPrototype, "TypedArray.prototype", ["constructor"]),
  ...captureMembers(TypedArrayPrototype, "TypedArray.prototype", ViewAccessors, "get"),
  ...captureMembers(Uint8Array.prototype, "Uint8Array.prototype", ["constructor"]),
  ...captureMembers(Uint8Array.prototype, "Uint8Array.prototype", ViewAccessors, "absent"),
  ...(NodeBuffer
    ? [
      ...captureMembers(NodeBuffer, "Buffer", ["prototype"]),
      ...captureMembers(NodeBuffer.prototype, "Buffer.prototype", ["constructor"]),
      ...captureMembers(NodeBuffer.prototype, "Buffer.prototype", ViewAccessors, "absent"),
    ]
    : []),
];

/** `await` on a native promise calls no project code while this member is unchanged. */
const PromiseConstructorDependency: BodyDependency = captureMembers(
  Promise.prototype,
  "Promise.prototype",
  ["constructor"],
)[0]!;

/**
 * Members used by Node's native Request body clone, read and construction steps.
 */
const NodeBodyDependencies: readonly BodyDependency[] = isNode
  ? [
    ...captureMembers(ReadableStream.prototype, "ReadableStream.prototype", [
      "tee",
      "getReader",
      "pipeThrough",
      "pipeTo",
    ]),
    ...captureMembers(
      ReadableStreamDefaultReader.prototype,
      "ReadableStreamDefaultReader.prototype",
      ["read", "releaseLock"],
    ),
    ...captureMembers(
      ReadableStreamDefaultController.prototype,
      "ReadableStreamDefaultController.prototype",
      ["enqueue", "close"],
    ),
    ...captureMembers(
      ReadableByteStreamController.prototype,
      "ReadableByteStreamController.prototype",
      ["enqueue", "close"],
    ),
    ...captureMembers(Array.prototype, "Array.prototype", ["push"]),
    ...captureMembers(Promise.prototype, "Promise.prototype", ["then"]),
    ...captureMembers(TextDecoder.prototype, "TextDecoder.prototype", ["decode"]),
    ...captureMembers(TextEncoder.prototype, "TextEncoder.prototype", ["encode"]),
    ...captureMembers(JSON, "JSON", ["parse"]),
  ]
  : [];

/**
 * Validate native body processing before a runtime invocation body is cloned,
 * read or rebuilt.
 *
 * Every runtime requires that the body prototypes keep the parents they had at
 * load, that none of them has own index properties, that `Object.prototype`
 * has no own `then`, and that `Promise.prototype.constructor` is unchanged. On
 * Node the native body members must also match the values captured at load.
 * Each error names the member that differs from its load-time value.
 */
export function assertNativeBodyProcessing(): void {
  for (let index = 0; index < BodyPrototypeLinks.length; index++) { // NOSONAR: Avoid mutable iterator hooks.
    const link = BodyPrototypeLinks[index]!;
    if (GetPrototypeOf(link[0]) !== link[1]) {
      throw new NativeTypeError(
        `Cannot process a request body with modified prototypes (${link[2]})`,
      );
    }
  }
  for (let index = 0; index < BodyPrototypeLinks.length; index++) { // NOSONAR: Avoid mutable iterator hooks.
    const link = BodyPrototypeLinks[index]!;
    const name = ownIndexProperty(link[0]);
    if (name !== undefined) {
      throw new NativeTypeError(
        `Cannot process a request body with inherited index properties (${link[2]}.${name})`,
      );
    }
  }
  if (GetOwnPropertyDescriptor(ObjectPrototype, "then") !== undefined) {
    throw new NativeTypeError(
      "Cannot process a request body with an inherited then (Object.prototype.then)",
    );
  }
  assertNativeAwait();
  for (let index = 0; index < BodyDependencies.length; index++) { // NOSONAR: Avoid mutable iterator hooks.
    const dependency = BodyDependencies[index]!;
    if (!dependencyHolds(dependency)) {
      throw new NativeTypeError(
        `Cannot process a request body with modified typed arrays (${dependency[4]})`,
      );
    }
  }
  for (let index = 0; index < NodeBodyDependencies.length; index++) { // NOSONAR: Avoid mutable iterator hooks.
    const dependency = NodeBodyDependencies[index]!;
    if (!dependencyHolds(dependency)) {
      throw new NativeTypeError(
        `Cannot process a request body with modified native streams (${dependency[4]})`,
      );
    }
  }
}

/**
 * Validate that awaiting a native promise calls no project code.
 *
 * Call it in the same synchronous step as each `await` on a promise that
 * settles with body data, after the promise is created.
 */
export function assertNativeAwait(): void {
  if (!dependencyHolds(PromiseConstructorDependency)) {
    throw new NativeTypeError(
      `Cannot process a request body with modified promises (${PromiseConstructorDependency[4]})`,
    );
  }
}
