# NLSpec: src/mcp/

## Purpose
Implements a JSON-RPC 2.0 MCP (Model Context Protocol) server that exposes registered tools, resources, and prompts over HTTP. Provides a unified registry facade and factory for creating MCP server instances with authentication, CORS, and lazy integration loading.

## Public API

### Exports
| Export | Type | Description |
|--------|------|-------------|
| `createMCPServer` | function | Factory that creates an `MCPServer` from config |
| `MCPServer` | class | JSON-RPC server handling MCP protocol methods over HTTP |
| `IntegrationLoaderConfig` | type | Configuration for lazy-loading integration tools from an external API |
| `getMCPRegistry` | function | Returns the current registry snapshot (tools, resources, prompts as Maps) |
| `registerTool` | function | Registers a tool by id in the global tool registry |
| `registerResource` | function | Registers a resource by id in the global resource registry |
| `registerPrompt` | function | Registers a prompt by id in the global prompt registry |
| `getMCPStats` | function | Returns counts of registered tools, resources, prompts, and total |
| `clearMCPRegistry` | function | Clears all three registries (tools, resources, prompts) |
| `MCPServerConfig` | type | Zod-inferred config: enabled, port, auth, cors |
| `MCPStats` | type | Shape: `{ tools, resources, prompts, total }` (all non-negative integers) |
| `MCPTool` | type | Generic tool definition with name, description, inputSchema (Zod), and execute function |
| `MCPServerConfigSchema` | schema | Zod schema for server config (from schemas/) |
| `MCPStatsSchema` | schema | Zod schema for stats (from schemas/) |

### Dependencies
| Import | From | Why |
|--------|------|-----|
| `toolRegistry`, `executeTool`, `zodToJsonSchema` | `#veryfront/tool` | Execute tools and convert Zod schemas to JSON Schema |
| `resourceRegistry` | `#veryfront/resource` | List and read resources by URI pattern |
| `promptRegistry` | `#veryfront/prompt` | List and render prompts with variables |
| `createError`, `toError` | `#veryfront/errors` | Structured error creation for MCP error responses |
| `withSpan` | `#veryfront/observability` | Distributed tracing for all MCP method handlers |
| `VERSION` | `#veryfront/utils` | Reports server version in `initialize` response |
| `validateContentType` | `#veryfront/security` | Validates `Content-Type: application/json` on HTTP requests |
| `VeryfrontError` | `#veryfront/security` | Type-check for content-type validation errors |
| `IntegrationRuntimeConfig` | `../integrations/types.ts` | Type for per-integration config in the loader |
| `fetchConnector`, `createIntegrationTools` | `../integrations/` | Dynamically imported for lazy integration tool loading |

## Behaviors

### Behavior 1: Server initialization (initialize method)
- **Given**: An MCP client connects
- **When**: `initialize` is called
- **Then**: Returns protocol version `"2024-11-05"`, server name `"veryfront-mcp"`, current VERSION, and capabilities (tools, resources with subscribe, prompts)
- **Edge cases**: Params are ignored

### Behavior 2: Tool listing (tools/list)
- **Given**: Tools registered in the global registry
- **When**: `tools/list` is called
- **Then**: Returns array of `{ name, description, inputSchema }` for each tool where `tool.mcp?.enabled !== false`
- **Edge cases**: Tools with `mcp.enabled === false` are excluded. Uses `inputSchemaJson` if available, falls back to `zodToJsonSchema`.

### Behavior 3: Lazy integration tool loading
- **Given**: `setIntegrationLoader()` was called with integration config
- **When**: First `tools/list` call is made
- **Then**: Fetches connectors from the API, creates integration tools, registers them in the global registry
- **Edge cases**: If fetch fails, `integrationsLoaded` remains `false` so the next `tools/list` retries. If a specific connector fails, other connectors still load; returns `false` only if any connector failed.

### Behavior 4: Tool execution (tools/call)
- **Given**: A tool is registered
- **When**: `tools/call` is called with `{ name, arguments }`
- **Then**: Executes the tool via `executeTool`, returns result as `{ content: [{ type: "text", text: JSON.stringify(result) }] }`
- **Edge cases**: Missing `name` param throws "Tool name is required". Tool execution context (endUserId, projectId) is forwarded from HTTP headers.

### Behavior 5: Resource listing and reading (resources/list, resources/read)
- **Given**: Resources registered in the global registry
- **When**: `resources/list` is called
- **Then**: Returns array of `{ uri, name, description, mimeType: "application/json" }`
- **When**: `resources/read` is called with `{ uri }`
- **Then**: Finds resource by URI pattern, extracts params, loads data, returns as JSON content
- **Edge cases**: Missing `uri` throws "Resource URI is required". Unknown URI throws "Resource not found: {uri}".

### Behavior 6: Prompt listing and rendering (prompts/list, prompts/get)
- **Given**: Prompts registered in the global registry
- **When**: `prompts/list` is called
- **Then**: Returns array of `{ name, description }`
- **When**: `prompts/get` is called with `{ name, arguments }`
- **Then**: Renders prompt content via `promptRegistry.getContent`, returns as user message
- **Edge cases**: Missing `name` throws "Prompt name is required". Unknown prompt throws from the prompt registry.

### Behavior 7: HTTP handler with auth and CORS
- **Given**: `createHTTPHandler()` is called
- **When**: An HTTP request arrives
- **Then**: Validates auth (if configured), validates Content-Type, parses JSON-RPC body, dispatches, returns JSON-RPC response
- **Edge cases**:
  - OPTIONS requests return 204 with CORS headers (bypasses auth)
  - Invalid Content-Type returns JSON-RPC error code -32700
  - Unparseable JSON body returns JSON-RPC error code -32700
  - Auth failure returns 401 plain text
  - Auth type `"none"` or absent skips validation
  - Only `bearer` auth type is implemented; `api-key` is in the schema but returns `false` from validateAuth

### Behavior 8: Request context extraction
- **Given**: HTTP request with `x-end-user-id` and/or `x-project-id` headers
- **When**: Headers are present and pass validation
- **Then**: Extracted into `ToolExecutionContext` and forwarded to tool execution
- **Edge cases**: IDs must be <= 255 chars and match allowlisted character patterns. Invalid/missing headers result in `undefined` context.

### Behavior 9: Unknown method handling
- **Given**: A JSON-RPC request with an unrecognized method
- **When**: `dispatch` is called
- **Then**: Throws an error with message "Unknown method: {method}"
- **Edge cases**: Error is caught by `handleRequest` and returned as JSON-RPC error code -32603

### Behavior 10: Registry facade (getMCPRegistry, getMCPStats, clearMCPRegistry)
- **Given**: Tools, resources, and/or prompts registered
- **When**: `getMCPRegistry()` is called
- **Then**: Returns `{ tools: Map, resources: Map, prompts: Map }` from underlying registries
- **When**: `getMCPStats()` is called
- **Then**: Returns `{ tools: N, resources: N, prompts: N, total: N }`
- **When**: `clearMCPRegistry()` is called
- **Then**: Clears all three registries

## Constraints
- Do NOT change public API signatures (all exports must remain identical)
- Do NOT modify files outside src/mcp/
- Do NOT add unnecessary abstractions, helpers, or utilities
- Do NOT add comments, docstrings, or type annotations to unchanged code
- Refactoring dimensions: dead code removal, naming clarity, nesting reduction, type safety
- Must pass: deno fmt --check src/mcp/ && deno lint src/mcp/

## Error Handling
- All `dispatch` errors are caught in `handleRequest` and returned as JSON-RPC error responses with code `-32603`
- Missing required params (tool name, resource URI, prompt name) throw structured `VeryfrontError` via `createError`/`toError`
- Content-Type validation failures return HTTP 400 with JSON-RPC error code `-32700`
- JSON parse failures return HTTP 400 with JSON-RPC error code `-32700`
- Auth failures return HTTP 401 plain text
- Integration loading failures are non-fatal and silently caught; retry on next `tools/list`

## Side Effects
- `registerTool`, `registerResource`, `registerPrompt` mutate global registries (singleton state)
- `clearMCPRegistry` clears all global registries
- `loadIntegrationTools` dynamically imports `../integrations/connector-fetcher.ts` and `../integrations/tool-factory.ts`, makes network requests to fetch connectors
- `withSpan` emits OpenTelemetry traces for each method handler
- `executeTool` may have arbitrary side effects depending on the tool

## Performance Constraints
- Integration tools are lazily loaded on first `tools/list` to avoid startup cost
- `zodToJsonSchema` conversion happens on every `tools/list` call unless `inputSchemaJson` is pre-computed on the tool

## Invariants
- All JSON-RPC responses include `jsonrpc: "2.0"` and the request `id`
- CORS headers are only set when `config.cors.enabled` is true
- The server always advertises protocol version `"2024-11-05"`
- `MCPStats.total` always equals `tools + resources + prompts`
- Tools with `mcp.enabled === false` are never exposed in `tools/list`
