# NLSpec: src/integrations/

## Purpose

This module provides two distinct capabilities for the Veryfront integration system. First, it serves as a static registry of integration metadata (names, display names, icons, auth configs, tool lists, prompts) exported via `veryfront/integrations` for use by Studio and documentation tooling. Second, it provides runtime machinery for fetching connector endpoint specifications from the API, generating executable `Tool` instances from those specs, and registering them into the MCP tool registry -- enabling AI agents to call third-party APIs (GitHub, Slack, etc.) on behalf of users via OAuth tokens.

## Public API

### Exports

| Export | Type | Description |
|--------|------|-------------|
| `IntegrationNameSchema` | `z.ZodEnum` | Zod schema validating known integration name strings |
| `IntegrationConfigSchema` | `z.ZodObject` | Zod schema for full integration configuration objects |
| `EnvVarSchema` | `z.ZodObject` | Zod schema for environment variable definitions |
| `OAuthConfigSchema` | `z.ZodObject` | Zod schema for OAuth/auth configuration |
| `OAuthFieldSchema` | `z.ZodObject` | Zod schema for OAuth form fields |
| `IntegrationToolSchema` | `z.ZodObject` | Zod schema for integration tool metadata |
| `IntegrationPromptSchema` | `z.ZodObject` | Zod schema for integration prompt definitions |
| `IntegrationName` | type | Union of all known integration name strings |
| `IntegrationConfig` | type | Full integration configuration (inferred from schema) |
| `EnvVarConfig` | type | Environment variable config type |
| `OAuthConfig` | type | OAuth configuration type |
| `OAuthField` | type | OAuth form field type |
| `IntegrationToolMeta` | type | Tool metadata type (static, from schema) |
| `IntegrationPrompt` | type | Prompt definition type |
| `IntegrationConnector` | type | Runtime connector definition (snake_case, from API) |
| `IntegrationRuntimeConfig` | type | Per-integration runtime config (perUser, tool allowlist) |
| `IntegrationTool` | type | Runtime tool definition within a connector |
| `getConnector(name)` | function | Look up static integration config by name |
| `listConnectors()` | function | Return all static integration configs |
| `getConnectorNames()` | function | Return all known integration names |
| `getIcon(name)` | function | Return raw SVG string for an integration |
| `fetchConnector(integration, apiBaseUrl, apiToken?)` | async function | Fetch connector spec from API with LRU caching |
| `clearConnectorCache()` | function | Clear the connector fetch cache (for testing) |
| `createIntegrationTools(connector, config, apiBaseUrl, apiToken?)` | function | Generate executable Tool instances from a connector spec |
| `executeEndpoint(endpoint, args, accessToken, ctx)` | async function | Execute an HTTP request defined by an endpoint spec |
| `registerIntegrationMCP(config)` | async function | Fetch connectors and register tools into MCP registry |
| `IntegrationMCPConfig` | type | Configuration for `registerIntegrationMCP` |

### Dependencies

| Import | From | Why |
|--------|------|-----|
| `z` (zod) | `zod` | Schema definitions and runtime validation |
| `logger` | `#veryfront/utils` | Structured logging for debug, warn, and error messages |
| `dynamicTool` | `#veryfront/tool` | Creates Tool instances with execute handlers |
| `Tool`, `ToolExecutionContext` | `#veryfront/tool` | Tool type and execution context interface |
| `registerTool` | `#veryfront/mcp` | Registers tools into the global MCP tool registry |

## Behaviors

### Behavior 1: Static connector metadata lookup

- **Given**: The module is imported
- **When**: `getConnector("slack")` is called
- **Then**: Returns the `IntegrationConfig` for Slack from the pre-built `_data.ts` map, or `undefined` if not found
- **Edge cases**: Unknown names return `undefined`; the lookup is O(1) via `Map`

### Behavior 2: List all connectors

- **Given**: The module is imported
- **When**: `listConnectors()` is called
- **Then**: Returns a readonly array of all `IntegrationConfig` objects from `_data.ts`

### Behavior 3: SVG icon lookup

- **Given**: The module is imported
- **When**: `getIcon("github")` is called
- **Then**: Returns the raw SVG string for GitHub, or `undefined` if no icon exists

### Behavior 4: Fetch connector spec from API (with caching)

- **Given**: An API base URL and optional token
- **When**: `fetchConnector("github", apiBaseUrl, token)` is called
- **Then**: Makes `GET /integrations/github` to the API and returns the parsed `IntegrationConnector`
- **Edge cases**:
  - Cached results are returned without a network call (TTL: 5 minutes)
  - 404 responses return `null` with a warning log
  - Non-OK responses return `null` with a warning log
  - Network errors return `null` with an error log
  - Cache is bounded to 100 entries; oldest entry is evicted on overflow
  - Expired entries are evicted lazily before inserting new ones

### Behavior 5: Generate executable tools from connector

- **Given**: A fetched `IntegrationConnector` and an `IntegrationRuntimeConfig`
- **When**: `createIntegrationTools(connector, config, apiBaseUrl, token)` is called
- **Then**: Returns an array of `Tool` instances, one per connector tool that has an `endpoint`
- **Edge cases**:
  - Tools without an `endpoint` field are skipped
  - If `config.tools` is set, only tools whose IDs are in the allowlist are included
  - An empty allowlist results in zero tools
  - Header params are excluded from the user-facing input schema
  - Tool IDs use `{integration}:{toolId}` format
  - All generated tools have `mcp.enabled = true`

### Behavior 6: Tool execution (token acquisition + endpoint call)

- **Given**: A tool generated by `createIntegrationTools` is executed with input and context
- **When**: `tool.execute(input, context)` is called
- **Then**: The tool fetches an OAuth token from `GET /oauth/token/{integration}?projectId=...`, then calls the external API endpoint
- **Edge cases**:
  - Missing `projectId` in context returns `{ error: "missing_project_id" }`
  - `authentication_required` token response returns the error with a `connectUrl` for the user
  - `refresh_failed` token response returns the error with its message
  - No access token in response returns `{ error: "no_token" }`
  - Network errors during token fetch return `{ error: "token_fetch_failed" }`
  - For `perUser` integrations, `endUserId` is appended to the token URL

### Behavior 7: Execute REST endpoint

- **Given**: An `IntegrationEndpoint` with `type` absent or not `"graphql"`
- **When**: `executeEndpoint(endpoint, args, token, ctx)` is called
- **Then**: Builds URL with path param substitution, query params, headers, and optional JSON body; executes the HTTP request; parses JSON or text response; applies optional response transform
- **Edge cases**:
  - Missing required path params throw an `Error`
  - Array-typed query params are appended individually via `searchParams.append`
  - Response transform extracts a single top-level key from the response object
  - Non-JSON responses are returned as text strings

### Behavior 8: Execute GraphQL endpoint

- **Given**: An `IntegrationEndpoint` with `type: "graphql"`
- **When**: `executeEndpoint(endpoint, args, token, ctx)` is called
- **Then**: Sends a POST with `{ query, variables }` body; returns `data` or the transformed sub-field
- **Edge cases**:
  - Missing `query` field throws an `Error`
  - If `data.errors` is present, the full response (including errors) is returned
  - Empty variables object is sent as `undefined` (omitted from payload)
  - Response transform extracts a sub-field from `data`

### Behavior 9: Register integration tools into MCP

- **Given**: An `IntegrationMCPConfig` with integration names and API credentials
- **When**: `registerIntegrationMCP(config)` is called
- **Then**: Fetches all connector specs in parallel, generates tools for each, registers them via `registerTool`, and returns the list of registered tool IDs
- **Edge cases**:
  - Empty integrations record returns immediately with empty `toolIds`
  - Connectors that fail to fetch are skipped with a warning log
  - Missing per-integration config defaults to `{}`

## Constraints

- Do NOT change public API signatures
- Do NOT modify files outside `src/integrations/`
- `_data.ts` is auto-generated and must not be edited manually
- Must pass: `deno fmt --check`, `deno lint`, `deno test --no-check --allow-all`

## Error Handling

- **connector-fetcher**: All errors are caught and logged; `null` is returned (never throws)
- **endpoint-executor**: Throws `Error` for missing path params and missing GraphQL queries; all other HTTP errors are returned as `{ result, status }` without throwing
- **tool-factory execute**: Token fetch errors are caught and returned as structured error objects (never throws); endpoint execution errors propagate from `executeEndpoint`
- **mcp-registration**: Failed connector fetches are logged and skipped; does not throw

## Side Effects

- **Network I/O**: `fetchConnector` makes HTTP GET to the API; `executeEndpoint` makes HTTP requests to external APIs; tool execution fetches OAuth tokens
- **Logging**: All runtime files log via the structured `logger` (debug, warn, error levels)
- **Module-level state**: `connector-fetcher.ts` maintains a module-scoped `Map` cache; `index.ts` builds module-scoped `Map` lookups from `_data.ts`
- **MCP registry mutation**: `registerIntegrationMCP` calls `registerTool` to add tools to the global MCP registry

## Performance Constraints

- Connector cache TTL is 5 minutes with a max of 100 entries
- Expired entries are evicted lazily (on next insert), not on a timer
- All connector fetches within `registerIntegrationMCP` run in parallel via `Promise.all`

## Invariants

- Tool IDs always follow the `{integrationName}:{toolId}` format
- Tools without an `endpoint` field are never exposed as executable tools
- The static `connectors` array and `icons` map are immutable after module initialization
- `fetchConnector` never throws; it always returns `IntegrationConnector | null`
- Tool execution always acquires a fresh token per invocation (tokens are not cached in the tool layer)
