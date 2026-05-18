---
title: "veryfront/tool"
description: "Define tools with schema-backed inputs for agents and MCP."
order: 10
---

# veryfront/tool

Define tools with schema-backed inputs for agents and MCP.

## Import

```ts
import {
  tool,
  dynamicTool,
  loadRemoteToolsFromSource,
  toolRegistry,
  createContext7ToolSource,
  createProjectScopedRemoteToolCatalog,
} from "veryfront/tool";
```

## Examples

### Basic tool

```ts
import { tool } from "veryfront/tool";
import { z } from "zod";

const convertLength = tool({
  id: "convert_length",
  description: "Convert meters to feet",
  inputSchema: z.object({ meters: z.number().nonnegative() }),
  execute: ({ meters }) => {
    return { feet: meters * 3.28084 };
  },
});
```

### Use with an agent

```ts
import { agent } from "veryfront/agent";
import { tool } from "veryfront/tool";
import { z } from "zod";

const convertLength = tool({
  id: "convert_length",
  description: "Convert meters to feet",
  inputSchema: z.object({ meters: z.number().nonnegative() }),
  execute: ({ meters }) => {
    return { feet: meters * 3.28084 };
  },
});

const assistant = agent({
  system: "You answer unit-conversion questions.",
  tools: { convert_length: convertLength },
});
```

### Load remote tools for an agent

```ts
import { agent } from "veryfront/agent";
import { createRemoteMCPToolSource, loadRemoteToolsFromSource } from "veryfront/tool";

const docsTools = createRemoteMCPToolSource({
  id: "docs-mcp",
  endpoint: "https://docs.example.com/mcp",
  headers: { Authorization: "Bearer <TOKEN>" },
});

const runtimeTools = await loadRemoteToolsFromSource(docsTools, {
  context: { projectId: "proj_123" },
  toolNameAliases: { search_docs: "docs_search" },
});

const assistant = agent({
  system: "Use the docs tools when a question needs project documentation.",
  tools: runtimeTools,
  maxSteps: 5,
});

const result = await assistant.generate({
  input: "Find the deployment guide for this project.",
});
```

## API

### `tool(config)`

Create typed tool (Zod-validated)

| Property | Type | Description |
|----------|------|-------------|
| `id?` | `string` | Tool identifier (optional, inferred from filename) |
| `description` | `string` | Tool description for the AI model |
| `inputSchema` | <code>Schema&lt;TInput&gt;</code> | Input schema produced via `defineSchema((v) => …)` (or any `SchemaValidator`-backed builder). Validates input before `execute` runs and seeds the JSON Schema exposed to AI providers. |
| `allowUnknownSchema?` | `boolean` | Allow unknown/non-contract schemas to fall back to a permissive JSON schema. Use only for truly dynamic tools; prefer `v.unknown()` or `v.any()` from the SchemaValidator DSL instead. |
| `execute` | <code>(input: TInput, context?: ToolExecutionContext) =&gt; Promise&lt;TOutput&gt; &#124; TOutput</code> | Tool execution function |
| `mcp?` | `object` | MCP configuration |

**Returns:** <code>Tool&lt;TInput, TOutput&gt;</code>

## Exports

### Components

| Name | Description | Source |
|------|-------------|--------|
| `DEFAULT_SLEEP_TOOL_MAX_SECONDS` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/sleep.ts#L5) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `createContext7ToolSource` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/context7.ts#L23) |
| `createProjectScopedRemoteToolCatalog` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts#L185) |
| `createRemoteMCPToolSource` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/remote-mcp.ts#L298) |
| `createSleepTool` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/sleep.ts#L46) |
| `createToolsFromHostDefinitions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/host-tools.ts#L82) |
| `createToolsFromHostDefinitions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/host-tools.ts#L86) |
| `createToolsFromHostDefinitions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/host-tools.ts#L90) |
| `createToolsFromRemoteDefinitions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/remote-source-tools.ts#L25) |
| `dynamicTool` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/factory.ts#L205) |
| `executeTool` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/executor.ts#L4) |
| `filterProjectScopedRemoteToolDefinitions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts#L111) |
| `hasToolExecutionErrorMarker` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/result.ts#L4) |
| `hydrateProjectScopedRemoteToolInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts#L125) |
| `isErroredToolExecutionResult` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/result.ts#L12) |
| `isProjectNavigationRemoteTool` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts#L93) |
| `isRemoteToolNameAllowed` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts#L104) |
| `listProjectScopedRemoteToolNames` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts#L272) |
| `loadRemoteToolsFromSource` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/remote-source-tools.ts#L53) |
| `resolveProjectScopedRemoteToolProjectId` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts#L147) |
| `tool` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/factory.ts#L154) |
| `traceHostTools` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/tracing.ts#L35) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `Context7ToolSourceConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/context7.ts#L4) |
| `CreateSleepToolOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/sleep.ts#L9) |
| `DynamicToolConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/factory.ts#L195) |
| `HostToolDefinition` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/host-tools.ts#L8) |
| `HostToolMaterializationOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/host-tools.ts#L29) |
| `HostToolSet` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/host-tools.ts#L21) |
| `HostToolTraceAttributeInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/tracing.ts#L10) |
| `HostToolTraceAttributes` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/tracing.ts#L8) |
| `HostToolTraceRunner` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/tracing.ts#L3) |
| `JsonSchema` | Minimal JSON Schema type used by the `SchemaValidator` contract for `toJsonSchema()`. Kept in the extensions/schema category so the contract can reference it without depending on any non-leaf module. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/json-schema.ts#L8) |
| `ListProjectScopedRemoteToolNameOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts#L53) |
| `ProjectScopedRemoteToolCatalog` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts#L42) |
| `ProjectScopedRemoteToolCatalogOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts#L12) |
| `ProjectScopedRemoteToolDefaultProjectId` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts#L6) |
| `ProjectScopedRemoteToolDefinitions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts#L25) |
| `ProjectScopedRemoteToolExecution` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts#L36) |
| `ProjectScopedRemoteToolExecutionInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts#L30) |
| `ProjectScopedRemoteToolOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts#L2) |
| `RemoteMCPToolSourceConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/remote-mcp.ts#L7) |
| `RemoteToolMaterializationOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/remote-source-tools.ts#L4) |
| `RemoteToolSource` | Remote tool source loaded dynamically at runtime. Hosts can provide these to expose tools from remote MCP-compatible systems without registering those tools globally inside the framework. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts#L166) |
| `SleepToolInput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/sleep.ts#L39) |
| `SleepToolOutput` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/sleep.ts#L41) |
| `SleepToolWait` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/sleep.ts#L7) |
| `Tool` | Tool instance (returned by tool() function) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts#L108) |
| `ToolConfig` | Tool configuration options | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts#L12) |
| `ToolDefinition` | Provider-facing tool definition used for model/tool registration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts#L153) |
| `ToolExecutionContext` | Context passed to tool execution | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts#L59) |
| `ToolExecutionDataEvent` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts#L88) |
| `ToolSet` | Runtime tool map keyed by the tool name exposed to an agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts#L148) |
| `TraceHostToolsOptions` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/tracing.ts#L16) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `sleepTool` | Default sleep tool (max 60 s) exposed as a property accessor so the underlying `tool({...})` materialization is deferred until first use. Preserves the existing `sleepTool.execute(...)` call shape. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/sleep.ts#L84) |
| `toolRegistry` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/registry.ts#L14) |

## Related

Reference modules:

- [`veryfront/agent`](./agent.md): Agents that use tools
- [`veryfront/mcp`](./mcp.md): Expose tools via MCP

User guides:

- [tools](../../guides/tools.md): Define and call tools

Architecture:

- [05-agent-runtime](../../architecture/05-agent-runtime.md): Tools as AI primitives
