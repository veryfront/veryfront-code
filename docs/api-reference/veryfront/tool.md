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
| `id?` | `string` | Tool identifier (optional, inferred from filename) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts#L15) |
| `description` | `string` | Tool description for the AI model | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts#L18) |
| `inputSchema` | <code>Schema&lt;TInput&gt; &#124; JsonSchema</code> | Input schema produced via `defineSchema((v) => …)` (or any `SchemaValidator`-backed builder), or a raw JSON Schema object for dynamic/project-authored tools. Schema validators parse before `execute`; raw JSON Schema is passed through to providers without runtime parsing. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts#L26) |
| `outputSchema?` | <code>Schema&lt;TOutput&gt; &#124; JsonSchema</code> | Optional output schema. Hosts can use this to document or validate structured tool results. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts#L32) |
| `allowUnknownSchema?` | `boolean` | Allow unknown/non-contract schemas to fall back to a permissive JSON schema. Use only for truly dynamic tools; prefer `v.unknown()` or `v.any()` from the SchemaValidator DSL instead. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts#L39) |
| `execute` | <code>(input: TInput, context?: ToolExecutionContext) =&gt; Promise&lt;TOutput&gt; &#124; TOutput</code> | Tool execution function | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts#L44) |
| `mcp?` | `object` | MCP configuration | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts#L47) |

**Returns:** <code>Tool&lt;TInput, TOutput&gt;</code>

## Exports

### Components

| Name | Description | Source |
|------|-------------|--------|
| `DEFAULT_SLEEP_TOOL_MAX_SECONDS` | Default value for sleep tool max seconds. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/sleep.ts#L7) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `createContext7ToolSource` | Create context7 tool source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/context7.ts#L26) |
| `createProjectScopedRemoteToolCatalog` | Create project scoped remote tool catalog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts#L225) |
| `createRemoteMCPToolSource` | Create remote MCP tool source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/remote-mcp.ts#L414) |
| `createSleepTool` | Create sleep tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/sleep.ts#L53) |
| `createToolsFromHostDefinitions` | Create tools from host definitions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/host-tools.ts#L80) |
| `createToolsFromHostDefinitions` | Create tools from host definitions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/host-tools.ts#L85) |
| `createToolsFromHostDefinitions` | Create tools from host definitions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/host-tools.ts#L90) |
| `createToolsFromRemoteDefinitions` | Create tools from remote definitions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/remote-source-tools.ts#L28) |
| `dynamicTool` | Create a dynamic tool definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/factory.ts#L179) |
| `executeTool` | Execute a tool definition with validated input. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/executor.ts#L15) |
| `filterProjectScopedRemoteToolDefinitions` | Filter project scoped remote tool definitions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts#L148) |
| `hasToolExecutionErrorMarker` | Check whether tool execution error marker is present. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/result.ts#L6) |
| `hydrateProjectScopedRemoteToolInput` | Input payload for hydrate project scoped remote tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts#L163) |
| `isErroredToolExecutionResult` | Result returned from is errored tool execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/result.ts#L15) |
| `isProjectNavigationRemoteTool` | Check whether a remote tool is project-navigation scoped. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts#L128) |
| `isRemoteToolNameAllowed` | Check whether a remote tool name is allowed. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts#L140) |
| `isToolVisibleTo` | Whether a registered tool is visible to the caller identified by the execution context. Unowned tools are project/global; owned tools are only visible to their owning agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/executor.ts#L10) |
| `listProjectScopedRemoteToolNames` | List project scoped remote tool names. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts#L314) |
| `loadRemoteToolsFromSource` | Loads remote tools from source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/remote-source-tools.ts#L57) |
| `resolveProjectScopedRemoteToolProjectId` | Resolves project scoped remote tool project ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts#L186) |
| `tool` | Create a typed tool definition. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/factory.ts#L115) |
| `traceHostTools` | Wrap host tools with tracing metadata. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/tracing.ts#L41) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `Context7ToolSourceConfig` | Configuration used by context7 tool source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/context7.ts#L6) |
| `CreateSleepToolOptions` | Options accepted by create sleep tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/sleep.ts#L13) |
| `DynamicToolConfig` | Configuration used by dynamic tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/factory.ts#L168) |
| `HostToolDefinition` | Definition for host tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/host-tools.ts#L10) |
| `HostToolMaterializationOptions` | Options accepted by host tool materialization. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/host-tools.ts#L33) |
| `HostToolSet` | Public API contract for host tool set. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/host-tools.ts#L24) |
| `HostToolTraceAttributeInput` | Input payload for host tool trace attribute. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/tracing.ts#L14) |
| `HostToolTraceAttributes` | Public API contract for host tool trace attributes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/tracing.ts#L11) |
| `HostToolTraceRunner` | Public API contract for host tool trace runner. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/tracing.ts#L5) |
| `JsonSchema` | Minimal JSON Schema type used by the `SchemaValidator` contract for `toJsonSchema()`. Kept in the extensions/schema category so the contract can reference it without depending on any non-leaf module. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/json-schema.ts#L9) |
| `ListProjectScopedRemoteToolNameOptions` | Options accepted by list project scoped remote tool name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts#L62) |
| `ProjectScopedRemoteToolCatalog` | Public API contract for project scoped remote tool catalog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts#L50) |
| `ProjectScopedRemoteToolCatalogOptions` | Options accepted by project scoped remote tool catalog. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts#L16) |
| `ProjectScopedRemoteToolDefaultProjectId` | Public API contract for project scoped remote tool default project ID. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts#L9) |
| `ProjectScopedRemoteToolDefinitions` | Public API contract for project scoped remote tool definitions. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts#L30) |
| `ProjectScopedRemoteToolExecution` | Public API contract for project scoped remote tool execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts#L43) |
| `ProjectScopedRemoteToolExecutionInput` | Input payload for project scoped remote tool execution. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts#L36) |
| `ProjectScopedRemoteToolOptions` | Options accepted by project scoped remote tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts#L4) |
| `RemoteMCPToolSourceConfig` | Configuration used by remote MCP tool source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/remote-mcp.ts#L9) |
| `RemoteToolMaterializationOptions` | Options accepted by remote tool materialization. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/remote-source-tools.ts#L6) |
| `RemoteToolSource` | Remote tool source loaded dynamically at runtime. Hosts can provide these to expose tools from remote MCP-compatible systems without registering those tools globally inside the framework. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts#L192) |
| `SleepToolInput` | Input payload for sleep tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/sleep.ts#L44) |
| `SleepToolOutput` | Output from sleep tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/sleep.ts#L47) |
| `SleepToolWait` | Public API contract for sleep tool wait. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/sleep.ts#L10) |
| `Tool` | Tool instance (returned by tool() function) | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts#L117) |
| `ToolConfig` | Tool configuration options | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts#L13) |
| `ToolDefinition` | Provider-facing tool definition used for model/tool registration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts#L179) |
| `ToolExecutionContext` | Context passed to tool execution | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts#L67) |
| `ToolExecutionDataEvent` | Event emitted for tool execution data. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts#L97) |
| `ToolSet` | Runtime tool map keyed by the tool name exposed to an agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts#L174) |
| `TraceHostToolsOptions` | Options accepted by trace host tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/tracing.ts#L21) |

### Constants

| Name | Description | Source |
|------|-------------|--------|
| `sleepTool` | Default sleep tool (max 60 s) exposed as a property accessor so the underlying `tool({...})` materialization is deferred until first use. Preserves the existing `sleepTool.execute(...)` call shape. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/sleep.ts#L91) |
| `toolRegistry` | Shared tool registry value. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/registry.ts#L44) |
