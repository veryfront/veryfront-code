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

type BodyPrototypeLink = readonly [prototype: BodyPrototype, parent: BodyPrototype | null];

function linkOf(prototype: BodyPrototype): BodyPrototypeLink {
  return [prototype, GetPrototypeOf(prototype) as BodyPrototype | null];
}

/** Each body prototype with the parent it had when this module loaded. */
const BodyPrototypeLinks: readonly BodyPrototypeLink[] = [
  linkOf(ObjectPrototype),
  linkOf(Array.prototype),
  linkOf(GetPrototypeOf(Uint8Array.prototype) as Uint8Array),
  linkOf(Uint8Array.prototype),
  linkOf(Promise.prototype),
  linkOf(ArrayBuffer.prototype),
  linkOf(DataView.prototype),
  linkOf(ReadableStream.prototype),
  linkOf(ReadableStreamDefaultReader.prototype),
  linkOf(ReadableStreamDefaultController.prototype),
  ...(typeof globalThis.ReadableByteStreamController === "function"
    ? [linkOf(ReadableByteStreamController.prototype)]
    : []),
  ...(NodeBuffer ? [linkOf(NodeBuffer.prototype)] : []),
];

/** True when `owner` has an own property whose name is made only of decimal digits. */
function hasOwnIndexProperty(owner: BodyPrototype): boolean {
  const names = GetOwnPropertyNames(owner);
  for (let index = 0; index < names.length; index++) { // NOSONAR: Avoid mutable iterator hooks.
    const name = names[index]!;
    let digits = name.length > 0;
    for (let offset = 0; digits && offset < name.length; offset++) {
      digits = name[offset]! >= "0" && name[offset]! <= "9";
    }
    if (digits) return true;
  }
  return false;
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
];

function captureMembers(
  target: BodyDependencyOwner,
  keys: readonly PropertyKey[],
  kind: BodyDependencyKind = "value",
): BodyDependency[] {
  const captured: BodyDependency[] = [];
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]!;
    const descriptor = GetOwnPropertyDescriptor(target, key);
    captured[index] = [target, key, kind, kind === "absent" ? undefined : descriptor?.[kind]];
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
  ...captureMembers(ArrayBuffer.prototype, ["constructor", "slice"]),
  ...captureMembers(ArrayBuffer, [Symbol.species], "get"),
  ...captureMembers(TypedArrayConstructor, [Symbol.species], "get"),
  ...captureMembers(TypedArrayPrototype, ["constructor"]),
  ...captureMembers(TypedArrayPrototype, ViewAccessors, "get"),
  ...captureMembers(Uint8Array.prototype, ["constructor"]),
  ...captureMembers(Uint8Array.prototype, ViewAccessors, "absent"),
  ...(NodeBuffer
    ? [
      ...captureMembers(NodeBuffer, ["prototype"]),
      ...captureMembers(NodeBuffer.prototype, ["constructor"]),
      ...captureMembers(NodeBuffer.prototype, ViewAccessors, "absent"),
    ]
    : []),
];

/**
 * Members used by Node's native Request body clone, read and construction steps.
 */
const NodeBodyDependencies: readonly BodyDependency[] = isNode
  ? [
    ...captureMembers(ReadableStream.prototype, [
      "tee",
      "getReader",
      "pipeThrough",
      "pipeTo",
    ]),
    ...captureMembers(ReadableStreamDefaultReader.prototype, ["read", "releaseLock"]),
    ...captureMembers(ReadableStreamDefaultController.prototype, [
      "enqueue",
      "close",
    ]),
    ...captureMembers(ReadableByteStreamController.prototype, ["enqueue", "close"]),
    ...captureMembers(Array.prototype, ["push"]),
    ...captureMembers(Promise.prototype, ["then"]),
    ...captureMembers(TextDecoder.prototype, ["decode"]),
    ...captureMembers(TextEncoder.prototype, ["encode"]),
    ...captureMembers(JSON, ["parse"]),
  ]
  : [];

/**
 * Validate native body processing before a runtime invocation body is cloned,
 * read or rebuilt.
 *
 * Every runtime requires that the body prototypes keep the parents they had at
 * load, that none of them has own index properties, and that `Object.prototype`
 * has no own `then`. On Node the native body members must also match the values
 * captured at load.
 */
export function assertNativeBodyProcessing(): void {
  for (let index = 0; index < BodyPrototypeLinks.length; index++) { // NOSONAR: Avoid mutable iterator hooks.
    const link = BodyPrototypeLinks[index]!;
    if (GetPrototypeOf(link[0]) !== link[1]) {
      throw new NativeTypeError("Cannot process a request body with modified prototypes");
    }
  }
  for (let index = 0; index < BodyPrototypeLinks.length; index++) { // NOSONAR: Avoid mutable iterator hooks.
    if (hasOwnIndexProperty(BodyPrototypeLinks[index]![0])) {
      throw new NativeTypeError("Cannot process a request body with inherited index properties");
    }
  }
  if (GetOwnPropertyDescriptor(ObjectPrototype, "then") !== undefined) {
    throw new NativeTypeError("Cannot process a request body with an inherited then");
  }
  for (let index = 0; index < BodyDependencies.length; index++) { // NOSONAR: Avoid mutable iterator hooks.
    if (!dependencyHolds(BodyDependencies[index]!)) {
      throw new NativeTypeError("Cannot process a request body with modified typed arrays");
    }
  }
  for (let index = 0; index < NodeBodyDependencies.length; index++) { // NOSONAR: Avoid mutable iterator hooks.
    if (!dependencyHolds(NodeBodyDependencies[index]!)) {
      throw new NativeTypeError("Cannot process a request body with modified native streams");
    }
  }
}
