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
| `inputSchema` | <code>Schema&lt;TInput&gt;</code> | Input schema produced via `defineSchema((v) => …)` (or any |
| `allowUnknownSchema?` | `boolean` | Allow unknown/non-contract schemas to fall back to a permissive JSON |
| `execute` | <code>(input: TInput, context?: ToolExecutionContext) =&gt; Promise&lt;TOutput&gt; &#124; TOutput</code> | Tool execution function |
| `mcp?` | `object` | MCP configuration |

**Returns:** <code>Tool&lt;TInput, TOutput&gt;</code>

## Exports

### Components

| Name | Description |
|------|-------------|
| `DEFAULT_SLEEP_TOOL_MAX_SECONDS` |  |

### Functions

| Name | Description |
|------|-------------|
| `createContext7ToolSource` |  |
| `createProjectScopedRemoteToolCatalog` |  |
| `createRemoteMCPToolSource` |  |
| `createSleepTool` |  |
| `createToolsFromHostDefinitions` |  |
| `createToolsFromHostDefinitions` |  |
| `createToolsFromHostDefinitions` |  |
| `createToolsFromRemoteDefinitions` |  |
| `dynamicTool` | Create tool with runtime schema |
| `executeTool` | Execute tool by ID |
| `filterProjectScopedRemoteToolDefinitions` |  |
| `hasToolExecutionErrorMarker` |  |
| `hydrateProjectScopedRemoteToolInput` |  |
| `isErroredToolExecutionResult` |  |
| `isProjectNavigationRemoteTool` |  |
| `isRemoteToolNameAllowed` |  |
| `listProjectScopedRemoteToolNames` |  |
| `loadRemoteToolsFromSource` |  |
| `resolveProjectScopedRemoteToolProjectId` |  |
| `tool` | Create typed tool (Zod-validated) |
| `traceHostTools` |  |

### Types

| Name | Description |
|------|-------------|
| `Context7ToolSourceConfig` |  |
| `CreateSleepToolOptions` |  |
| `DynamicToolConfig` | `dynamicTool()` config |
| `HostToolDefinition` |  |
| `HostToolMaterializationOptions` |  |
| `HostToolSet` |  |
| `HostToolTraceAttributeInput` |  |
| `HostToolTraceAttributes` |  |
| `HostToolTraceRunner` |  |
| `JsonSchema` | Minimal JSON Schema type used by the `SchemaValidator` contract for |
| `ListProjectScopedRemoteToolNameOptions` |  |
| `ProjectScopedRemoteToolCatalog` |  |
| `ProjectScopedRemoteToolCatalogOptions` |  |
| `ProjectScopedRemoteToolDefaultProjectId` |  |
| `ProjectScopedRemoteToolDefinitions` |  |
| `ProjectScopedRemoteToolExecution` |  |
| `ProjectScopedRemoteToolExecutionInput` |  |
| `ProjectScopedRemoteToolOptions` |  |
| `RemoteMCPToolSourceConfig` |  |
| `RemoteToolMaterializationOptions` |  |
| `RemoteToolSource` | Remote tool source loaded dynamically at runtime. |
| `SleepToolInput` |  |
| `SleepToolOutput` |  |
| `SleepToolWait` |  |
| `Tool` | Tool instance (returned by tool() function) |
| `ToolConfig` | Tool configuration options |
| `ToolDefinition` | Provider-facing tool definition used for model/tool registration. |
| `ToolExecutionContext` | Context passed to tool execution |
| `ToolExecutionDataEvent` |  |
| `ToolSet` | Runtime tool map keyed by the tool name exposed to an agent. |
| `TraceHostToolsOptions` |  |

### Constants

| Name | Description |
|------|-------------|
| `sleepTool` | Default sleep tool (max 60 s) exposed as a property accessor so the |
| `toolRegistry` | Global tool registry |

## Related

Reference modules:

- [`veryfront/agent`](./agent.md): Agents that use tools
- [`veryfront/mcp`](./mcp.md): Expose tools via MCP

User guides:

- [tools](../../guides/tools.md): Define and call tools

Architecture:

- [05-agent-runtime](../../architecture/05-agent-runtime.md): Tools as AI primitives
