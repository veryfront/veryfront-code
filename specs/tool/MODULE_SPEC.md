# NLSpec: src/tool/

## Purpose
Define tools with Zod schemas for AI agents and MCP. Provides `tool()` and `dynamicTool()` factories that create `Tool` instances with input validation, JSON Schema conversion, and execution. Includes a `toolRegistry`, a `executeTool()` dispatcher, a Zod-to-JSON-Schema converter, and testing utilities.

## Public API

### Exports
| Export | Type | Description |
|--------|------|-------------|
| `tool` | function | Factory for typed tools with Zod input schemas |
| `dynamicTool` | function | Factory for dynamic tools with unknown/flexible schemas |
| `DynamicToolConfig` | interface | Config type for `dynamicTool()` |
| `toolRegistry` | instance | Project-scoped registry with provider-facing definitions |
| `executeTool` | function | Dispatch tool execution by ID from registry |
| `Tool` | interface | Tool instance: `id`, `type`, `description`, `inputSchema`, `execute()` |
| `ToolConfig` | interface | Typed tool config |
| `ToolDefinition` | interface | Provider-facing definition: `name`, `description`, `parameters` (JSON Schema) |
| `ToolExecutionContext` | interface | Execution context: `agentId?`, `projectId?`, `endUserId?`, `blobStorage?` |
| `JsonSchema` | type | JSON Schema type definition |

### Dependencies
| Import | From | Why |
|--------|------|-----|
| `createError`, `toError`, `getErrorMessage` | `#veryfront/errors/veryfront-error.ts` | Structured error creation |
| `agentLogger` | `#veryfront/utils/logger/logger.ts` | Schema conversion logging |
| `ProjectScopedRegistryManager` | `#veryfront/ai/registry-manager.ts` | Multi-project registry isolation |
| `ScopedRegistryFacade` | `#veryfront/ai/registry-facade.ts` | Registry access API |
| `BlobStorage` (type) | `#veryfront/workflow/blob/types.ts` | Tool context type |
| `z`, `ZodFirstPartyTypeKind` | `zod` | Schema types and type discriminator |

## Behaviors

### Behavior 1: Create typed tool
- **Given**: A `ToolConfig` with `inputSchema` (Zod), `description`, and `execute`
- **When**: `tool(config)` is called
- **Then**: Returns a `Tool` with `type: "function"`, pre-converted `inputSchemaJson`, and validated execution
- **Edge cases**: Auto-generates ID if not provided; validates input with `schema.parse()` before execute

### Behavior 2: Create dynamic tool
- **Given**: A `DynamicToolConfig` with unknown/flexible schema
- **When**: `dynamicTool(config)` is called
- **Then**: Returns a `Tool` with `type: "dynamic"`, permissive JSON schema fallback
- **Edge cases**: Applies `toModelOutput` transform if provided

### Behavior 3: Zod-to-JSON-Schema conversion
- **Given**: A Zod schema (string, number, boolean, object, array, enum, union, etc.)
- **When**: `zodToJsonSchema(schema)` is called
- **Then**: Returns equivalent JSON Schema
- **Supported types**: ZodString, ZodNumber, ZodBoolean, ZodBigInt, ZodLiteral, ZodEnum, ZodNativeEnum, ZodObject, ZodArray, ZodTuple, ZodUnion, ZodDiscriminatedUnion, ZodRecord, ZodDefault, ZodLazy, ZodEffects
- **Edge cases**: Nullable wraps in `anyOf: [schema, { type: "null" }]`; optional is tracked but not in output; invalid schema throws; unknown types fall back to `{ type: "object" }`

### Behavior 4: Schema conversion with fallbacks
- **Given**: A tool with a non-standard Zod schema (different Zod instance, external library)
- **When**: `convertSchemaToJson()` processes it
- **Then**: Tries: (1) standard zodToJsonSchema, (2) shape introspection, (3) permissive fallback if `allowUnknownSchema` is set
- **Edge cases**: Without `allowUnknownSchema`, unknown schemas throw

### Behavior 5: Execute tool by ID
- **Given**: A tool registered in `toolRegistry`
- **When**: `executeTool(id, input, context)` is called
- **Then**: Retrieves tool from registry and calls `tool.execute(input, context)`
- **Edge cases**: Unknown ID throws agent error `Tool "X" not found`

### Behavior 6: Get tools for provider
- **Given**: Tools registered in the registry
- **When**: `toolRegistry.getToolsForProvider()` is called
- **Then**: Returns `ToolDefinition[]` with `name`, `description`, and `parameters` (JSON Schema)
- **Edge cases**: Uses pre-converted schema if available, falls back to runtime conversion

### Behavior 7: Tool testing
- **Given**: A `Tool` and array of `ToolTestCase` objects
- **When**: `testTool(tool, cases)` is called
- **Then**: Runs each case, returns `ToolTestResult[]` with pass/fail, timing, error messages
- **Modes**: Expected output (deep partial match), custom validator, should-throw with error pattern

## Constraints
- Do NOT change public API signatures
- Do NOT modify files outside src/tool/
- Refactoring dimensions: dead code removal, naming clarity, nesting reduction, type safety
- Must pass: deno task verify:quick

## Error Handling
- Input validation failure: throws agent error with validation message
- Schema conversion failure: throws agent error (unless `allowUnknownSchema`)
- Tool not found: throws agent error
- Invalid Zod schema (missing `_def`): throws Error

## Side Effects
- Logging: `agentLogger.info()` during schema conversion and provider definition

## Performance Constraints
- JSON Schema conversion happens at tool creation time (not per-call)

## Invariants
- `tool()` always pre-converts the input schema to JSON Schema at creation time
- `dynamicTool()` always uses permissive mode for schema conversion
- `tool.type` is always `"function"` for typed tools, `"dynamic"` for dynamic tools
- Tool input is always validated via `schema.parse()` before execution (typed tools only)
