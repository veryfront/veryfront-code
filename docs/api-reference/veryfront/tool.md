---
title: "veryfront/tool"
description: "Define tools with schema-backed inputs for agents and MCP."
order: 27
---

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
  inputSchema: z.object({
    meters: z.number().nonnegative().describe("Length in meters"),
  }),
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
  inputSchema: z.object({
    meters: z.number().nonnegative().describe("Length in meters"),
  }),
  execute: ({ meters }) => {
    return { feet: meters * 3.28084 };
  },
});

const assistant = agent({
  system: "You answer unit-conversion questions.",
  tools: { convert_length: convertLength },
  maxSteps: 5,
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

Create a typed tool definition.

| Property | Type | Description | Source |
|----------|------|-------------|--------|
| `id?` | `string` | Tool identifier (optional, inferred from filename) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts#L14) |
| `description` | `string` | Tool description for the AI model | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts#L17) |
| `inputSchema` | <code>Schema&lt;TInput&gt;</code> | Input schema produced via `defineSchema((v) => …)` (or any `SchemaValidator`-backed builder). Validates input before `execute` runs and seeds the JSON Schema exposed to AI providers. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts#L24) |
| `outputSchema?` | <code>Schema&lt;TOutput&gt;</code> | Optional output schema. Hosts can use this to document or validate structured tool results. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts#L30) |
| `allowUnknownSchema?` | `boolean` | Allow unknown/non-contract schemas to fall back to a permissive JSON schema. Use only for truly dynamic tools; prefer `v.unknown()` or `v.any()` from the SchemaValidator DSL instead. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts#L37) |
| `execute` | <code>(input: TInput, context?: ToolExecutionContext) =&gt; Promise&lt;TOutput&gt; &#124; TOutput</code> | Tool execution function | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts#L42) |
| `mcp?` | `object` | MCP configuration | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts#L45) |

**Returns:** <code>Tool&lt;TInput, TOutput&gt;</code>

## Exports

### Components

| Name | Description | Source |
|------|-------------|--------|
| `DEFAULT_SLEEP_TOOL_MAX_SECONDS` | Default value for sleep tool max seconds. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/sleep.ts#L6) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `createContext7ToolSource` | Create context7 tool source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/context7.ts#L25) |
| `createProjectScopedRemoteToolCatalog` | Create project scoped remote tool catalog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts#L199) |
| `createRemoteMCPToolSource` | Create remote MCP tool source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/remote-mcp.ts#L300) |
| `createSleepTool` | Create sleep tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/sleep.ts#L52) |
| `createToolsFromHostDefinitions` | Create tools from host definitions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/host-tools.ts#L86) |
| `createToolsFromHostDefinitions` | Create tools from host definitions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/host-tools.ts#L91) |
| `createToolsFromHostDefinitions` | Create tools from host definitions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/host-tools.ts#L96) |
| `createToolsFromRemoteDefinitions` | Create tools from remote definitions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/remote-source-tools.ts#L27) |
| `dynamicTool` | Create a dynamic tool definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/factory.ts#L218) |
| `executeTool` | Execute a tool definition with validated input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/executor.ts#L5) |
| `filterProjectScopedRemoteToolDefinitions` | Filter project scoped remote tool definitions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts#L122) |
| `hasToolExecutionErrorMarker` | Check whether tool execution error marker is present. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/result.ts#L5) |
| `hydrateProjectScopedRemoteToolInput` | Input payload for hydrate project scoped remote tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts#L137) |
| `isErroredToolExecutionResult` | Result returned from is errored tool execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/result.ts#L14) |
| `isProjectNavigationRemoteTool` | Check whether a remote tool is project-navigation scoped. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts#L102) |
| `isRemoteToolNameAllowed` | Check whether a remote tool name is allowed. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts#L114) |
| `listProjectScopedRemoteToolNames` | List project scoped remote tool names. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts#L287) |
| `loadRemoteToolsFromSource` | Loads remote tools from source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/remote-source-tools.ts#L56) |
| `resolveProjectScopedRemoteToolProjectId` | Resolves project scoped remote tool project ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts#L160) |
| `tool` | Create a typed tool definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/factory.ts#L155) |
| `traceHostTools` | Wrap host tools with tracing metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/tracing.ts#L40) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `Context7ToolSourceConfig` | Configuration used by context7 tool source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/context7.ts#L5) |
| `CreateSleepToolOptions` | Options accepted by create sleep tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/sleep.ts#L12) |
| `DynamicToolConfig` | Configuration used by dynamic tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/factory.ts#L207) |
| `HostToolDefinition` | Definition for host tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/host-tools.ts#L9) |
| `HostToolMaterializationOptions` | Options accepted by host tool materialization. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/host-tools.ts#L32) |
| `HostToolSet` | Public API contract for host tool set. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/host-tools.ts#L23) |
| `HostToolTraceAttributeInput` | Input payload for host tool trace attribute. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/tracing.ts#L13) |
| `HostToolTraceAttributes` | Public API contract for host tool trace attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/tracing.ts#L10) |
| `HostToolTraceRunner` | Public API contract for host tool trace runner. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/tracing.ts#L4) |
| `JsonSchema` | Minimal JSON Schema type used by the `SchemaValidator` contract for `toJsonSchema()`. Kept in the extensions/schema category so the contract can reference it without depending on any non-leaf module. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/json-schema.ts#L8) |
| `ListProjectScopedRemoteToolNameOptions` | Options accepted by list project scoped remote tool name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts#L61) |
| `ProjectScopedRemoteToolCatalog` | Public API contract for project scoped remote tool catalog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts#L49) |
| `ProjectScopedRemoteToolCatalogOptions` | Options accepted by project scoped remote tool catalog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts#L15) |
| `ProjectScopedRemoteToolDefaultProjectId` | Public API contract for project scoped remote tool default project ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts#L8) |
| `ProjectScopedRemoteToolDefinitions` | Public API contract for project scoped remote tool definitions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts#L29) |
| `ProjectScopedRemoteToolExecution` | Public API contract for project scoped remote tool execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts#L42) |
| `ProjectScopedRemoteToolExecutionInput` | Input payload for project scoped remote tool execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts#L35) |
| `ProjectScopedRemoteToolOptions` | Options accepted by project scoped remote tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts#L3) |
| `RemoteMCPToolSourceConfig` | Configuration used by remote MCP tool source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/remote-mcp.ts#L8) |
| `RemoteToolMaterializationOptions` | Options accepted by remote tool materialization. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/remote-source-tools.ts#L5) |
| `RemoteToolSource` | Remote tool source loaded dynamically at runtime. Hosts can provide these to expose tools from remote MCP-compatible systems without registering those tools globally inside the framework. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts#L177) |
| `SleepToolInput` | Input payload for sleep tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/sleep.ts#L43) |
| `SleepToolOutput` | Output from sleep tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/sleep.ts#L46) |
| `SleepToolWait` | Public API contract for sleep tool wait. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/sleep.ts#L9) |
| `Tool` | Tool instance (returned by tool() function) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts#L113) |
| `ToolConfig` | Tool configuration options | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts#L12) |
| `ToolDefinition` | Provider-facing tool definition used for model/tool registration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts#L164) |
| `ToolExecutionContext` | Context passed to tool execution | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts#L65) |
| `ToolExecutionDataEvent` | Event emitted for tool execution data. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts#L93) |
| `ToolSet` | Runtime tool map keyed by the tool name exposed to an agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts#L159) |
| `TraceHostToolsOptions` | Options accepted by trace host tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/tracing.ts#L20) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `sleepTool` | Default sleep tool (max 60 s) exposed as a property accessor so the underlying `tool({...})` materialization is deferred until first use. Preserves the existing `sleepTool.execute(...)` call shape. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/sleep.ts#L90) |
| `toolRegistry` | Shared tool registry value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/registry.ts#L15) |
