import {
  canIdentifyProxyWithoutHooks,
  isProxyWithoutHooks,
} from "#veryfront/platform/compat/error-introspection.ts";

/** Serialized immutable snapshot and its acknowledged retention deadline. */
export interface DependencySnapshotRecord {
  readonly value: string;
  readonly expiresAt: number;
}

/**
 * Host-owned shared snapshot storage. Implementations must authorize access,
 * bound reads to 1 MiB, and reject publication unless retention is acknowledged.
 * A node-local cache does not satisfy this capability for replicated runtimes.
 *
 * Configure it through an opaque RuntimeAdapter handle. Without this capability, standalone history stays
 * process-local. Replicas must use the same project and branch/release identity.
 * The namespace is its SHA-256 digest; the key is a canonical dependency pin.
 * Values are opaque, immutable UTF-8 strings. Identical publication is idempotent;
 * different bytes at the same namespace/key must fail, never overwrite.
 *
 * Methods must be own data properties, not getters or inherited methods.
 * This capability requires native proxy detection, available on Deno, Node, and
 * Bun. Hosts without it reject provider configuration before inspecting methods.
 * Runtime operations have a five-second deadline and at most 64 unresolved
 * producers. Local history holds at most 4,096 entries or 32 MiB of serialized
 * values. Default requested retention is 23 hours, 59 minutes, leaving 60 seconds
 * for relative clock differences below the hard 24-hour ceiling.
 */
export interface DependencySnapshotStore {
  /** Resolves only after storage retains the exact value until expiresAt (epoch ms). */
  publish(
    namespace: string,
    key: string,
    value: string,
    expiresAt: number,
    signal?: AbortSignal,
  ): Promise<void>;
  /** Returns null only for missing/expired history; outage and invalid data must reject. */
  read(
    namespace: string,
    key: string,
    signal?: AbortSignal,
  ): Promise<DependencySnapshotRecord | null>;
}

const capturedStores = new WeakMap<object, DependencySnapshotStore>();
const apply = Reflect.apply;
const freeze = Object.freeze;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const weakGet = WeakMap.prototype.get;
const weakSet = WeakMap.prototype.set;
const hasOwn = Object.hasOwn;
declare const snapshotStoreHandleBrand: unique symbol;

/** Opaque host storage reference. It exposes no privileged read or publish methods. */
export interface DependencySnapshotStoreHandle {
  readonly [snapshotStoreHandleBrand]: true;
}

const handles = new WeakMap<DependencySnapshotStoreHandle, DependencySnapshotStore>();

/** Capture a provider for RuntimeAdapter without placing its methods in renderer state. */
export function createDependencySnapshotStoreHandle(
  store: DependencySnapshotStore,
): DependencySnapshotStoreHandle {
  const captured = captureDependencySnapshotStore(store);
  const handle = freeze({}) as DependencySnapshotStoreHandle;
  apply(weakSet, handles, [handle, captured]);
  return handle;
}

/** @internal Only host runtime modules resolve the opaque adapter capability. */
export function resolveDependencySnapshotStoreHandle(value: unknown): DependencySnapshotStore {
  const store = value !== null && typeof value === "object"
    ? apply(weakGet, handles, [value]) as DependencySnapshotStore | undefined
    : undefined;
  if (!store) {
    throw new TypeError("Use createDependencySnapshotStoreHandle to configure snapshot storage");
  }
  return store;
}

/** Capture an explicit host capability without invoking accessors or proxy traps. */
export function captureDependencySnapshotStore(value: unknown): DependencySnapshotStore {
  if (!canIdentifyProxyWithoutHooks) {
    throw new TypeError("Dependency snapshot storage requires native proxy detection");
  }
  if (value === null || typeof value !== "object" || isProxyWithoutHooks(value)) {
    throw new TypeError("Dependency snapshot store must be a non-proxy object");
  }
  const cached = apply(weakGet, capturedStores, [value]) as DependencySnapshotStore | undefined;
  if (cached) return cached;
  const publish = getOwnPropertyDescriptor(value, "publish");
  const read = getOwnPropertyDescriptor(value, "read");
  if (
    !publish || !hasOwn(publish, "value") || typeof publish.value !== "function" ||
    !read || !hasOwn(read, "value") || typeof read.value !== "function"
  ) throw new TypeError("Dependency snapshot store methods must be own data properties");
  const publishMethod = publish.value as DependencySnapshotStore["publish"];
  const readMethod = read.value as DependencySnapshotStore["read"];
  const captured: DependencySnapshotStore = freeze({
    publish: (...args: Parameters<DependencySnapshotStore["publish"]>) =>
      apply(publishMethod, value, args),
    read: (...args: Parameters<DependencySnapshotStore["read"]>) => apply(readMethod, value, args),
  });
  apply(weakSet, capturedStores, [value, captured]);
  apply(weakSet, capturedStores, [captured, captured]);
  return captured;
}
