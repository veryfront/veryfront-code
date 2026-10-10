import { isNode } from "#veryfront/platform/compat/runtime.ts";

const GetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const HasOwn = Object.hasOwn;
const NativeTypeError = TypeError;
const ObjectPrototype = Object.prototype;

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
 * Operations that Node's native Request body clone, read and construction steps
 * look up on shared prototypes while the body bytes are reachable.
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
    ...captureMembers(Object.getPrototypeOf(Uint8Array.prototype) as Uint8Array, [
      "byteLength",
      "length",
    ], "get"),
  ]
  : [];

/**
 * Reject known mutable dependencies before a credential-bearing request body is
 * cloned, read or rebuilt.
 *
 * Promise resolution reads `then` from every resolved object, including stream
 * read results and parsed JSON payloads, so an inherited `then` is rejected on
 * every runtime. On Node the native body operations are also checked.
 */
export function assertNativeBodyProcessing(): void {
  if (GetOwnPropertyDescriptor(ObjectPrototype, "then") !== undefined) {
    throw new NativeTypeError("Cannot process a request body with an inherited then");
  }
  for (let index = 0; index < NodeBodyDependencies.length; index++) {
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
