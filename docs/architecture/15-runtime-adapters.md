# Runtime adapters

This page describes runtime adapter capability boundaries. It does not cover
deployment targets or build output generation.

## Responsibility

Runtime adapters normalize Deno, Node.js, Bun, and constrained edge runtime
capabilities behind shared server, filesystem, and environment access patterns.

Primary source areas:

- [`src/platform/`](../../src/platform/)
- [`src/platform/adapters/`](../../src/platform/adapters/)
- [`src/platform/cloud/`](../../src/platform/cloud/)
- [`src/fs/`](../../src/fs/)
- [`src/server/project-env/`](../../src/server/project-env/)

## Runtime flow

1. Runtime detection selects an adapter for the current host.
2. Adapter code exposes HTTP serving, filesystem, environment, and process
   capabilities in a shared shape.
3. Virtual filesystem adapters can replace or augment local file access.
4. Project environment helpers resolve framework and project variables.

## Boundaries

- Runtime adapter support is separate from deployment product support.
- Build pipeline code can target a runtime, but adapters own runtime capability
  normalization.
- Security checks for paths and sandbox behavior belong in dedicated security
  modules.

## Dependency snapshot storage

`RuntimeAdapter.dependencySnapshotStore` accepts an optional opaque
`DependencySnapshotStoreHandle` created by `createDependencySnapshotStoreHandle(provider)`.
Provider methods remain in private host state, outside renderer cache traversal.
Without a configured provider, standalone history is process-local.

Shared storage requires native proxy detection, available on Deno, Node, and Bun.
Hosts without this capability reject provider configuration before inspecting
provider methods. Their default process-local history remains available.
Replicas share history only when their project and branch/release identities match.
The shared namespace excludes replica-local mount paths when a project identity is present.

| Contract                                             | Behavior                                                                                                                                                                               |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `publish(namespace, key, value, expiresAt, signal?)` | Resolves after storage acknowledges retention of the exact value through the epoch-millisecond deadline. Identical writes are idempotent; different bytes at the same identity fail.   |
| `read(namespace, key, signal?)`                      | Returns `{ value, expiresAt }`, or `null` for missing/expired history. Authorization errors, outages, and corrupt records reject.                                                      |
| Limits                                               | 1 MiB per serialized value, 23-hour 59-minute default retention with a hard 24-hour ceiling, 4,096 entries or 32 MiB in local history, 64 unresolved operations, five-second deadline. |
| Historical reads                                     | Restore exact dependency declarations without granting current dependency writeback authority.                                                                                         |

The host supplies own data-property methods. Project-writable caches and node-local
disk caches do not satisfy this capability. The provider must retain acknowledged
records for their lifetime; early cache eviction violates the contract.

You must configure the adapter before its first request. The framework captures
both configured storage and its absence; later adapter property replacements do
not change that choice.

```ts
import {
  createDependencySnapshotStoreHandle,
  type DependencySnapshotStore,
  type RuntimeAdapter,
} from "veryfront/platform";

export function configureSharedHistory(
  adapter: RuntimeAdapter,
  provider: DependencySnapshotStore,
): void {
  Object.defineProperty(adapter, "dependencySnapshotStore", {
    value: createDependencySnapshotStoreHandle(provider),
  });
}
```

The default leaves 60 seconds of headroom for relative clock differences between
publishers, readers, the API, and storage. Explicit full-duration publications do
not have that headroom. This does not synchronize clocks near record expiry.

The framework does not acquire Cloud credentials or select a storage transport
from environment variables. Cloud integration supplies the provider separately.
The opaque handle prevents accidental provider exposure through renderer state;
it is not a security sandbox. A provider that uses privileged credentials requires
an execution boundary that keeps those credentials and its authorization outside
untrusted project code. Configured storage failures do not downgrade to local history.

The provider, handle, record types, and handle factory are exported by
`veryfront/platform`.

## Change checks

- Update [support matrix](./20-support-matrix.md) when runtime support changes.
- Add runtime-specific tests or compatibility tests for adapter behavior changes.

## Related guides

- [Deploying](../guides/deploying.md)
- [Configuration](../guides/configuration.md)

## Related reference

- [`veryfront/fs`](../api-reference/veryfront/fs.md)
