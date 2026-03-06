# NLSpec: src/ai/

## Purpose
Provides multi-tenant, project-scoped isolation for AI registries (tools, prompts, workflows, agents, resources, providers). Each project gets its own namespace via AsyncLocalStorage context, preventing cross-project leakage, while a shared registry layer makes framework-provided items available to all projects.

## Public API

### Exports
| Export | Type | Description |
|--------|------|-------------|
| `ProjectScopedRegistryManager<T>` | class | Core registry with per-project isolation and shared-item fallback |
| `ScopedRegistryFacade<T>` | class | Thin delegation wrapper that domain registries extend to expose a clean public surface |

### Dependencies
| Import | From | Why |
|--------|------|-----|
| `tryGetCacheKeyContext` | `#veryfront/cache/cache-key-builder.ts` | Reads the current project ID from AsyncLocalStorage to determine which project's registry to use |
| `agentLogger` | `#veryfront/utils/logger/logger.ts` | Debug-level logging for register, delete, and clear operations |

## Behaviors

### Behavior 1: Project-scoped registration and retrieval
- **Given**: A `ProjectScopedRegistryManager<T>` instance
- **When**: `register(id, item)` is called
- **Then**: The item is stored under the current project's namespace (derived from AsyncLocalStorage context)
- **Edge cases**: If the same `id` is registered twice for the same project, the second value silently overwrites the first (with a debug log)

### Behavior 2: Shared registration (cross-project)
- **Given**: A manager instance
- **When**: `registerShared(id, item)` is called
- **Then**: The item is stored in a global shared registry accessible to all projects
- **Edge cases**: Duplicate shared ids overwrite silently (with debug log)

### Behavior 3: Lookup with project-then-shared fallback
- **Given**: Both a project registry and a shared registry may contain items
- **When**: `get(id)` is called
- **Then**: Returns the project-scoped item if it exists, otherwise falls back to the shared registry, otherwise returns `undefined`
- **Edge cases**: A project item with the same id as a shared item takes precedence (shadow/override semantics)

### Behavior 4: Existence check with project-then-shared fallback
- **Given**: Both a project registry and a shared registry may contain items
- **When**: `has(id)` is called
- **Then**: Returns `true` if the item exists in the project registry OR the shared registry
- **Edge cases**: Must correctly fall through to shared registry even when a project registry exists but does not contain the requested id

### Behavior 5: Enumerate all items (merged view)
- **Given**: A manager with project and/or shared items
- **When**: `getAllIds()` or `getAll()` is called
- **Then**: Returns a merged, deduplicated view where project items override shared items with the same id
- **Edge cases**: If no project registry exists, returns only shared items

### Behavior 6: Deletion scoping
- **Given**: A manager with project and/or shared items
- **When**: `delete(id)` is called
- **Then**: Removes the item only from the current project's registry; shared items are never deleted via `delete()`
- **Edge cases**: Returns `false` if the project has no registry, or if the id is not in the project registry (even if it exists in shared)

### Behavior 7: Clear operations (three granularities)
- **Given**: A manager instance
- **When**: `clear()` / `clearProject(projectId)` / `clearAll()` is called
- **Then**:
  - `clear()`: removes the current project's registry; shared items unaffected
  - `clearProject(projectId)`: removes a specific project's registry by explicit id
  - `clearAll()`: removes all project registries AND shared items (intended for testing)

### Behavior 8: Statistics reporting
- **Given**: A manager with some items registered
- **When**: `getStats()` is called
- **Then**: Returns `{ projectCount, sharedCount, totalItems, currentProjectItems }` reflecting current state

### Behavior 9: Facade delegation
- **Given**: A `ScopedRegistryFacade<T>` wrapping a `ProjectScopedRegistryManager<T>`
- **When**: Any method is called on the facade
- **Then**: It delegates 1:1 to the underlying manager with no transformation
- **Edge cases**: The facade exposes `protected readonly manager` so subclasses can add domain-specific methods

### Behavior 10: Default project fallback
- **Given**: No AsyncLocalStorage context is available (CLI, tests, startup)
- **When**: Any operation that needs a project id executes
- **Then**: Falls back to the sentinel `"__default__"` project id

## Constraints
- Do NOT change public API signatures (all exports must remain identical)
- Do NOT modify files outside src/ai/
- Do NOT add unnecessary abstractions, helpers, or utilities
- Do NOT add comments, docstrings, or type annotations to unchanged code
- Refactoring dimensions: dead code removal, naming clarity, nesting reduction, type safety
- Must pass: `deno fmt --check src/ai/ && deno lint src/ai/`

## Error Handling
- No exceptions are thrown by the registry itself; all operations are safe
- `get()` returns `undefined` for missing items rather than throwing
- `delete()` returns `false` for missing items rather than throwing
- Debug-level logging via `agentLogger` for all mutations (register, overwrite, delete, clear)

## Side Effects
- Reads from AsyncLocalStorage (via `tryGetCacheKeyContext`) on every operation to determine project scope
- Writes debug log lines via `agentLogger` on every mutation

## Performance Constraints
- Lookups (`get`, `has`) are O(1) Map operations per registry layer (project + shared = at most 2 lookups)
- `getAll()` creates a new merged Map on every call (not cached); suitable for infrequent enumeration, not hot paths
- `getStats()` iterates all project registries to compute `totalItems`; O(number of projects)

## Invariants
- A project's items are never visible to another project
- Shared items are visible to all projects unless shadowed by a project-scoped item with the same id
- `delete()` never removes shared items
- `clear()` never removes shared items
- `clearAll()` is the only operation that removes shared items
- The merged view from `getAll()` always gives project items precedence over shared items
