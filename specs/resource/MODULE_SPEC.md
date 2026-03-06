# NLSpec: src/resource/

## Purpose
Declare and register MCP resources with data loading and subscription capabilities. Provides a `resource()` factory that creates `Resource` instances with Zod-validated params and a `resourceRegistry` for project-scoped storage with URI pattern matching.

## Public API

### Exports
| Export | Type | Description |
|--------|------|-------------|
| `resource` | function | Factory that creates a `Resource` from a `ResourceConfig` |
| `resourceRegistry` | instance | Project-scoped registry with pattern matching and param extraction |
| `Resource` | interface | Resource instance with `load()`, optional `subscribe()`, pattern, params schema |
| `ResourceConfig` | interface | Config: `pattern?`, `description`, `paramsSchema`, `load`, `subscribe?`, `mcp?` |

### Dependencies
| Import | From | Why |
|--------|------|-----|
| `createError`, `toError` | `#veryfront/errors/veryfront-error.ts` | Structured error creation |
| `ProjectScopedRegistryManager` | `#veryfront/ai/registry-manager.ts` | Multi-project registry isolation |
| `ScopedRegistryFacade` | `#veryfront/ai/registry-facade.ts` | Registry access API |
| `z` (type only) | `zod` | Schema types for params validation |

## Behaviors

### Behavior 1: Create resource with params validation
- **Given**: A `ResourceConfig` with a `paramsSchema` and `load` function
- **When**: `resource(config)` is called, then `load(params)` is invoked
- **Then**: Validates params against `paramsSchema`, then calls `config.load(params)`
- **Edge cases**: Invalid params throws agent error with validation message

### Behavior 2: Auto-generated pattern and ID
- **Given**: A `ResourceConfig` without a `pattern`
- **When**: `resource(config)` is called
- **Then**: Generates pattern `/resource_{timestamp}`, derives ID by stripping slashes/colons

### Behavior 3: Pattern to ID conversion
- **Given**: A pattern like `/users/:userId/profile`
- **When**: `resource()` processes it
- **Then**: ID becomes `users_userId_profile` (strip leading `/`, replace `/` with `_`, remove `:`)

### Behavior 4: Registry findByPattern
- **Given**: Resources registered with URI patterns (e.g., `docs/:section`)
- **When**: `resourceRegistry.findByPattern("docs/api")` is called
- **Then**: Returns the matching resource (converts `:param` to regex capture groups)

### Behavior 5: Registry extractParams
- **Given**: A URI and a pattern
- **When**: `resourceRegistry.extractParams("docs/api", "docs/:section")` is called
- **Then**: Returns `{ section: "api" }`

## Constraints
- Do NOT change public API signatures
- Do NOT modify files outside src/resource/
- Must pass: deno task verify:quick

## Error Handling
- Params validation failure: throws structured agent error with validation message
- All errors use `createError({ type: "agent", message })` pattern

## Side Effects
- None

## Invariants
- `resource()` always validates params via `paramsSchema.parse()` before calling `load()`
- Pattern matching uses regex with named capture groups from `:param` segments
