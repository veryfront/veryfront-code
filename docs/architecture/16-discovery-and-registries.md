# Discovery and registries

This page describes project primitive discovery and registry population. It does
not cover extension package discovery.

## Responsibility

Discovery code scans project conventions, imports primitives, and registers
tools, agents, skills, workflows, prompts, resources, tasks, schedules,
webhooks, and eval definitions.

Primary source areas:

- [`src/discovery/`](../../src/discovery/)
- [`src/registry/`](../../src/registry/)
- [`src/modules/`](../../src/modules/)
- [`src/tool/registry.ts`](../../src/tool/registry.ts)
- [`src/resource/registry.ts`](../../src/resource/registry.ts)
- [`src/workflow/registry.ts`](../../src/workflow/registry.ts)
- [`src/skill/registry.ts`](../../src/skill/registry.ts)

## Runtime flow

1. Discovery snapshots and validates the complete configuration before its
   first filesystem operation.
2. It scans configured project directories in deterministic order. One
   generation has a shared 100,000-entry scan budget, in addition to depth and
   per-walk limits.
3. Module loading and transpilation prepare TypeScript or framework source for
   import. Evaluated-module caches are project-scope aware and revalidate both
   entry files and bundled dependencies.
4. Handlers validate supported primitive exports before registration.
5. Registry mutations are staged as one project-scoped transaction.
6. Runtime surfaces read the published generation during server, agent,
   workflow, MCP, and Studio operations.

## Generation publication

`discoverAll()` preserves its public compatibility contract: it returns
structured per-source errors and atomically publishes the valid subset. It
never exposes a registry assembled partly from an old generation and partly
from a new one.

Long-lived lifecycle owners use `replaceDiscoveredProjectPrimitives()` instead.
Its default policy rejects any generation containing a discovery error and
keeps the previous complete generation live. Development reloads and production
server startup use this strict path, so a malformed primitive cannot silently
start or replace a working server generation.

Clearing the discovery cache invalidates evaluated modules and package
resolution metadata together. This lets a reload observe changes to entry
files, relative dependencies, and package entry-point metadata.

The framework's evaluated-module index is bounded, but the host ESM loader
does not expose an API for unloading an evaluated module. A process therefore
retains one host module for each distinct source generation it has evaluated,
even after Veryfront evicts its own cache entry. Production runtimes that serve
sustained high-churn deployments must recycle their worker processes
periodically; true in-process unloading would require an isolated worker or VM
execution architecture rather than another cache layer.

## Boundaries

- Discovery imports project primitives. Extension lifecycle is documented in
  [extension system](./12-extension-system.md).
- Registries provide storage and lookup. They do not execute primitives.
- Project discovery roots are canonical project-relative paths. Absolute paths,
  file URLs, empty segments, dot segments, and traversal segments are rejected
  before filesystem access.
- Adapter directory entries are treated as untrusted filesystem metadata.
  Invalid names and operational read failures fail closed.

## Change checks

- Add fixture-based discovery tests when changing convention paths or export
  detection.
- Preserve project scoping to avoid cross-project registry leakage.
- Verify both strict rejection/rollback and compatibility-mode valid-subset
  publication when changing generation behavior.
- Exercise native and adapter-backed module loading when changing transpilation
  or cache behavior.

## Related guides

- [Project structure](../guides/project-structure.md)

## Related reference

- [`veryfront/agent`](../api-reference/veryfront/agent.md)
- [`veryfront/tool`](../api-reference/veryfront/tool.md)
- [`veryfront/workflow`](../api-reference/veryfront/workflow.md)
