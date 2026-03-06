# NLSpec: src/prompt/

## Purpose
Declare and register prompts exposable over MCP. Provides a `prompt()` factory that creates `Prompt` instances with template interpolation or dynamic generation, and a `promptRegistry` for project-scoped prompt storage and retrieval.

## Public API

### Exports
| Export | Type | Description |
|--------|------|-------------|
| `prompt` | function | Factory that creates a `Prompt` from a `PromptConfig` |
| `promptRegistry` | instance | Project-scoped registry for storing and retrieving prompts |
| `Prompt` | interface | Prompt instance: `id`, `description`, `suggestion?`, `getContent()` |
| `PromptConfig` | type | Config: `id?`, `description`, `content?`, `generate?`, `suggestion?` |

### Dependencies
| Import | From | Why |
|--------|------|-----|
| `createError`, `toError` | `#veryfront/errors/veryfront-error.ts` | Structured error creation |
| `ProjectScopedRegistryManager` | `#veryfront/ai/registry-manager.ts` | Multi-project registry isolation |
| `ScopedRegistryFacade` | `#veryfront/ai/registry-facade.ts` | Registry access API |
| `z` (type only) | `zod` | Schema validation for PromptConfig |

## Behaviors

### Behavior 1: Create prompt with static content
- **Given**: A `PromptConfig` with a `content` string containing `{variable}` placeholders
- **When**: `prompt(config)` is called, then `getContent({ variable: "value" })` is invoked
- **Then**: Returns the content with `{variable}` replaced by the provided value
- **Edge cases**: Missing variables leave `{variable}` placeholder unchanged; `null`/`undefined` values leave placeholder unchanged

### Behavior 2: Create prompt with dynamic generator
- **Given**: A `PromptConfig` with a `generate` function (no `content`)
- **When**: `prompt(config)` is called, then `getContent(variables)` is invoked
- **Then**: Returns the result of `generate(variables)`

### Behavior 3: Prompt with neither content nor generate
- **Given**: A `PromptConfig` with neither `content` nor `generate`
- **When**: `getContent()` is called
- **Then**: Throws an agent error: `Prompt "X" has no content or generator`

### Behavior 4: Auto-generated prompt ID
- **Given**: A `PromptConfig` without an `id`
- **When**: `prompt(config)` is called
- **Then**: Generates an ID using `prompt_{timestamp}_{counter}`

### Behavior 5: Registry getContent
- **Given**: A prompt registered in `promptRegistry`
- **When**: `promptRegistry.getContent(id, variables)` is called
- **Then**: Returns the prompt's content with interpolated variables
- **Edge cases**: If ID not found, throws agent error `Prompt "X" not found`

### Behavior 6: Registry list
- **Given**: Prompts registered in the registry
- **When**: `promptRegistry.list()` is called
- **Then**: Returns array of all registered prompt IDs

## Constraints
- Do NOT change public API signatures
- Do NOT modify files outside src/prompt/
- Must pass: deno task verify:quick

## Error Handling
- Missing prompt in registry: throws structured agent error
- Prompt with no content/generate: throws structured agent error
- All errors use `createError({ type: "agent", message })` pattern

## Side Effects
- None (registry state is managed by the AI registry-manager infrastructure)

## Invariants
- `prompt()` always returns a valid `Prompt` with an `id` (auto-generated if not provided)
- `getContent()` always returns a string (either from interpolation or generator)
- Variable interpolation only replaces `{word}` patterns (alphanumeric + underscore)
