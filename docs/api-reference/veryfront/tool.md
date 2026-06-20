---
title: "veryfront/tool"
description: "Define tools with schema-backed inputs for agents and MCP."
order: 28
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
import { defineSchema } from "veryfront/schemas";

const convertLength = tool({
  id: "convert_length",
  description: "Convert meters to feet",
  inputSchema: defineSchema((v) =>
    v.object({
      meters: v.number().nonnegative().describe("Length in meters"),
    })
  )(),
  execute: ({ meters }) => {
    return { feet: meters * 3.28084 };
  },
});
```

### Use with an agent

```ts
import { agent } from "veryfront/agent";
import { tool } from "veryfront/tool";
import { defineSchema } from "veryfront/schemas";

const convertLength = tool({
  id: "convert_length",
  description: "Convert meters to feet",
  inputSchema: defineSchema((v) =>
    v.object({
      meters: v.number().nonnegative().describe("Length in meters"),
    })
  )(),
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
| `inputSchema` | <code>Schema&lt;TInput&gt; &#124; JsonSchema</code> | Input schema produced via `defineSchema((v) => …)` (or any `SchemaValidator`-backed builder), or a raw JSON Schema object for dynamic/project-authored tools. Schema validators parse before `execute`; raw JSON Schema is passed through to providers without runtime parsing. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts#L25) |
| `outputSchema?` | <code>Schema&lt;TOutput&gt; &#124; JsonSchema</code> | Optional output schema. Hosts can use this to document or validate structured tool results. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts#L31) |
| `allowUnknownSchema?` | `boolean` | Allow unknown/non-contract schemas to fall back to a permissive JSON schema. Use only for truly dynamic tools; prefer `v.unknown()` or `v.any()` from the SchemaValidator DSL instead. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts#L38) |
| `execute` | <code>(input: TInput, context?: ToolExecutionContext) =&gt; Promise&lt;TOutput&gt; &#124; TOutput</code> | Tool execution function | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts#L43) |
| `mcp?` | `object` | MCP configuration | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts#L46) |

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
| `createProjectScopedRemoteToolCatalog` | Create project scoped remote tool catalog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts#L241) |
| `createRemoteMCPToolSource` | Create remote MCP tool source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/remote-mcp.ts#L413) |
| `createSleepTool` | Create sleep tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/sleep.ts#L52) |
| `createToolsFromHostDefinitions` | Create tools from host definitions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/host-tools.ts#L79) |
| `createToolsFromHostDefinitions` | Create tools from host definitions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/host-tools.ts#L84) |
| `createToolsFromHostDefinitions` | Create tools from host definitions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/host-tools.ts#L89) |
| `createToolsFromRemoteDefinitions` | Create tools from remote definitions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/remote-source-tools.ts#L27) |
| `dynamicTool` | Create a dynamic tool definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/factory.ts#L178) |
| `executeTool` | Execute a tool definition with validated input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/executor.ts#L14) |
| `filterProjectScopedRemoteToolDefinitions` | Filter project scoped remote tool definitions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts#L164) |
| `hasToolExecutionErrorMarker` | Check whether tool execution error marker is present. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/result.ts#L5) |
| `hydrateProjectScopedRemoteToolInput` | Input payload for hydrate project scoped remote tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts#L179) |
| `isErroredToolExecutionResult` | Result returned from is errored tool execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/result.ts#L14) |
| `isProjectNavigationRemoteTool` | Check whether a remote tool is project-navigation scoped. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts#L144) |
| `isRemoteToolNameAllowed` | Check whether a remote tool name is allowed. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts#L156) |
| `isToolVisibleTo` | Whether a registered tool is visible to the caller identified by the execution context. Unowned tools are project/global; owned tools are only visible to their owning agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/executor.ts#L9) |
| `listProjectScopedRemoteToolNames` | List project scoped remote tool names. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts#L330) |
| `loadRemoteToolsFromSource` | Loads remote tools from source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/remote-source-tools.ts#L56) |
| `resolveProjectScopedRemoteToolProjectId` | Resolves project scoped remote tool project ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts#L202) |
| `tool` | Create a typed tool definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/factory.ts#L114) |
| `traceHostTools` | Wrap host tools with tracing metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/tracing.ts#L40) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `Context7ToolSourceConfig` | Configuration used by context7 tool source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/context7.ts#L5) |
| `CreateSleepToolOptions` | Options accepted by create sleep tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/sleep.ts#L12) |
| `DynamicToolConfig` | Configuration used by dynamic tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/factory.ts#L167) |
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
| `RemoteToolSource` | Remote tool source loaded dynamically at runtime. Hosts can provide these to expose tools from remote MCP-compatible systems without registering those tools globally inside the framework. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts#L191) |
| `SleepToolInput` | Input payload for sleep tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/sleep.ts#L43) |
| `SleepToolOutput` | Output from sleep tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/sleep.ts#L46) |
| `SleepToolWait` | Public API contract for sleep tool wait. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/sleep.ts#L9) |
| `Tool` | Tool instance (returned by tool() function) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts#L116) |
| `ToolConfig` | Tool configuration options | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts#L12) |
| `ToolDefinition` | Provider-facing tool definition used for model/tool registration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts#L178) |
| `ToolExecutionContext` | Context passed to tool execution | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts#L66) |
| `ToolExecutionDataEvent` | Event emitted for tool execution data. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts#L96) |
| `ToolSet` | Runtime tool map keyed by the tool name exposed to an agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts#L173) |
| `TraceHostToolsOptions` | Options accepted by trace host tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/tracing.ts#L20) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `sleepTool` | Default sleep tool (max 60 s) exposed as a property accessor so the underlying `tool({...})` materialization is deferred until first use. Preserves the existing `sleepTool.execute(...)` call shape. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/sleep.ts#L90) |
| `toolRegistry` | Shared tool registry value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/registry.ts#L43) |
