import { isNode } from "#veryfront/platform/compat/runtime.ts";

const GetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const HasOwn = Object.hasOwn;
const NativeTypeError = TypeError;
const ObjectPrototype = Object.prototype;
const ArrayPrototype = Array.prototype;
const GetOwnPropertyNames = Object.getOwnPropertyNames;

/** True when `owner` has an own property whose name is made only of decimal digits. */
function hasOwnIndexProperty(owner: typeof ArrayPrototype | typeof ObjectPrototype): boolean {
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
  | Uint8Array;

type BodyDependency = readonly [
  target: BodyDependencyOwner,
  key: PropertyKey,
  kind: "value" | "get",
  captured: unknown,
];

function captureMembers(
  target: BodyDependencyOwner,
  keys: readonly PropertyKey[],
  kind: "value" | "get" = "value",
): BodyDependency[] {
  const captured: BodyDependency[] = [];
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]!;
    captured[index] = [target, key, kind, GetOwnPropertyDescriptor(target, key)?.[kind]];
  }
  return captured;
}

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
    ...captureMembers(Uint8Array.prototype, ["constructor"]),
    ...captureMembers(
      (Reflect.get(globalThis, "Buffer") as { prototype: Uint8Array }).prototype,
      ["constructor"],
    ),
    ...captureMembers(Object.getPrototypeOf(Uint8Array.prototype) as Uint8Array, [
      "byteLength",
      "length",
    ], "get"),
  ]
  : [];

/**
 * Validate native body processing before a runtime invocation body is cloned,
 * read or rebuilt.
 *
 * Every runtime requires that `Object.prototype` has no own `then` and that
 * `Array.prototype` and `Object.prototype` have no own index properties. On Node
 * the native body members must also match the values captured at load.
 */
export function assertNativeBodyProcessing(): void {
  if (GetOwnPropertyDescriptor(ObjectPrototype, "then") !== undefined) {
    throw new NativeTypeError("Cannot process a request body with an inherited then");
  }
  if (hasOwnIndexProperty(ArrayPrototype) || hasOwnIndexProperty(ObjectPrototype)) {
    throw new NativeTypeError("Cannot process a request body with inherited index properties");
  }
  for (let index = 0; index < NodeBodyDependencies.length; index++) { // NOSONAR: Avoid mutable iterator hooks.
    const dependency = NodeBodyDependencies[index]!;
    const descriptor = GetOwnPropertyDescriptor(dependency[0], dependency[1]);
    if (
      !descriptor || !HasOwn(descriptor, dependency[2]) ||
      descriptor[dependency[2]] !== dependency[3]
    ) {
      throw new NativeTypeError("Cannot process a request body with modified native streams");
    }
  }
}
