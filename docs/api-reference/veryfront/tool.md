---
title: "veryfront/tool"
description: "Define tools with schema-backed inputs for agents and MCP."
order: 40
---

## Import

```ts
import {
  createContext7ToolSource,
  createProjectScopedRemoteToolCatalog,
  dynamicTool,
  loadRemoteToolsFromSource,
  tool,
  toolRegistry,
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

| Property                     | Type                                                                                                     | Description                                                                                                                                                                                                                                                                     | Source                                                                            |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `id?`                        | `string`                                                                                                 | Tool identifier (optional, inferred from filename)                                                                                                                                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts) |
| `description`                | `string`                                                                                                 | Tool description for the AI model                                                                                                                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts) |
| `delegatedIntegrationTools?` | `readonly string[]`                                                                                      | Native integration tools this local wrapper may call through the platform. Hosts use this metadata for connection binding and least-privilege runtime authorization. These dependencies are not exposed to the model as tools.                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts) |
| `inputSchema`                | <code>Schema&lt;TInput&gt; &#124; JsonSchema</code>                                                      | Input schema produced via `defineSchema((v) => …)` (or any `SchemaValidator`-backed builder), or a raw JSON Schema object for dynamic/project-authored tools. Schema validators parse before `execute`; raw JSON Schema is passed through to providers without runtime parsing. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts) |
| `outputSchema?`              | <code>Schema&lt;TOutput&gt; &#124; JsonSchema</code>                                                     | Optional output schema. Hosts can use this to document or validate structured tool results.                                                                                                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts) |
| `allowUnknownSchema?`        | `boolean`                                                                                                | Allow unknown/non-contract schemas to fall back to a permissive JSON schema. Use only for truly dynamic tools; prefer `v.unknown()` or `v.any()` from the SchemaValidator DSL instead.                                                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts) |
| `execute`                    | <code>(input: TInput, context?: ToolExecutionContext) =&gt; Promise&lt;TOutput&gt; &#124; TOutput</code> | Tool execution function                                                                                                                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts) |
| `mcp?`                       | `object`                                                                                                 | MCP configuration                                                                                                                                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts) |

**Returns:** <code>Tool&lt;TInput, TOutput&gt;</code>

## Exports

### Components

| Name                             | Description                               | Source                                                                            |
| -------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------- |
| `DEFAULT_SLEEP_TOOL_MAX_SECONDS` | Default value for sleep tool max seconds. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/sleep.ts) |

### Functions

| Name                                            | Description                                                                                                                                                                   | Source                                                                                                  |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `createContext7ToolSource`                      | Create context7 tool source.                                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/context7.ts)                    |
| `createProjectScopedRemoteToolCatalog`          | Create project-scoped remote tool catalog.                                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts) |
| `createRemoteMCPToolSource`                     | Create a remote MCP source with the framework's guarded outbound transport.                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/remote-mcp.ts)                  |
| `createRemoteMCPToolSourceFactoryWithTransport` | Create a remote MCP source factory with narrowly scoped host transport.                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/remote-mcp.ts)                  |
| `createSleepTool`                               | Create sleep tool.                                                                                                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/sleep.ts)                       |
| `createToolsFromHostDefinitions`                | Create tools from host definitions.                                                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/host-tools.ts)                  |
| `createToolsFromRemoteDefinitions`              | Create tools from remote definitions.                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/remote-source-tools.ts)         |
| `dynamicTool`                                   | Create a dynamic tool definition.                                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/factory.ts)                     |
| `executeTool`                                   | Execute a tool definition with validated input.                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/executor.ts)                    |
| `filterProjectScopedRemoteToolDefinitions`      | Filter project-scoped remote tool definitions.                                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts) |
| `hasToolExecutionErrorMarker`                   | Check whether tool execution error marker is present.                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/result.ts)                      |
| `hydrateProjectScopedRemoteToolInput`           | Input payload for hydrate project-scoped remote tool.                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts) |
| `isErroredToolExecutionResult`                  | Result returned from is errored tool execution.                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/result.ts)                      |
| `isProjectNavigationRemoteTool`                 | Check whether a remote tool is project-navigation scoped.                                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts) |
| `isRemoteToolNameAllowed`                       | Check whether a remote tool name is allowed.                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts) |
| `isToolVisibleTo`                               | Whether a registered tool is visible to the caller identified by the execution context. Unowned tools are project/global; owned tools are only visible to their owning agent. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/executor.ts)                    |
| `listProjectScopedRemoteToolNames`              | List project-scoped remote tool names.                                                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts) |
| `loadRemoteToolsFromSource`                     | Loads remote tools from source.                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/remote-source-tools.ts)         |
| `resolveProjectScopedRemoteToolProjectId`       | Resolves project-scoped remote tool project ID.                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts) |
| `tool`                                          | Create a typed tool definition.                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/factory.ts)                     |
| `traceHostTools`                                | Wrap host tools with tracing metadata.                                                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/tracing.ts)                     |

### Types

| Name                                      | Description                                                                                                                                                                                 | Source                                                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `Context7ToolSourceConfig`                | Configuration used by context7 tool source.                                                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/context7.ts)                    |
| `CreateSleepToolOptions`                  | Options accepted by create sleep tool.                                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/sleep.ts)                       |
| `DynamicToolConfig`                       | Configuration used by dynamic tool.                                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/factory.ts)                     |
| `HostToolDefinition`                      | Definition for host tool.                                                                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/host-tools.ts)                  |
| `HostToolMaterializationOptions`          | Options accepted by host tool materialization.                                                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/host-tools.ts)                  |
| `HostToolSet`                             | Public API contract for host tool set.                                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/host-tools.ts)                  |
| `HostToolTraceAttributeInput`             | Input payload for host tool trace attribute.                                                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/tracing.ts)                     |
| `HostToolTraceAttributes`                 | Public API contract for host tool trace attributes.                                                                                                                                         | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/tracing.ts)                     |
| `HostToolTraceRunner`                     | Public API contract for host tool trace runner.                                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/tracing.ts)                     |
| `JsonSchema`                              |                                                                                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/extensions/schema/json-schema.ts)    |
| `ListProjectScopedRemoteToolNameOptions`  | Options accepted by list project-scoped remote tool name.                                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts) |
| `ProjectScopedRemoteToolCatalog`          | Public API contract for project-scoped remote tool catalog.                                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts) |
| `ProjectScopedRemoteToolCatalogOptions`   | Options accepted by project-scoped remote tool catalog.                                                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts) |
| `ProjectScopedRemoteToolDefaultProjectId` | Public API contract for project-scoped remote tool default project ID.                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts) |
| `ProjectScopedRemoteToolDefinitions`      | Public API contract for project-scoped remote tool definitions.                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts) |
| `ProjectScopedRemoteToolExecution`        | Public API contract for project-scoped remote tool execution.                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts) |
| `ProjectScopedRemoteToolExecutionInput`   | Input payload for project-scoped remote tool execution.                                                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts) |
| `ProjectScopedRemoteToolOptions`          | Options accepted by project-scoped remote tool.                                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/project-scoped-remote-tools.ts) |
| `RemoteMCPToolSourceConfig`               | Configuration used by remote MCP tool source.                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/remote-mcp.ts)                  |
| `RemoteMCPToolSourceTransportOptions`     | Deployment-owned transport policy for trusted MCP endpoint roots.                                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/remote-mcp.ts)                  |
| `RemoteToolMaterializationOptions`        | Options accepted by remote tool materialization.                                                                                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/remote-source-tools.ts)         |
| `RemoteToolSource`                        | Remote tool source loaded dynamically at runtime. Hosts can provide these to expose tools from remote MCP-compatible systems without registering those tools globally inside the framework. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts)                       |
| `SleepToolInput`                          | Input payload for sleep tool.                                                                                                                                                               | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/sleep.ts)                       |
| `SleepToolOutput`                         | Output from sleep tool.                                                                                                                                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/sleep.ts)                       |
| `SleepToolWait`                           | Public API contract for sleep tool wait.                                                                                                                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/sleep.ts)                       |
| `Tool`                                    | Tool instance (returned by tool() function)                                                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts)                       |
| `ToolConfig`                              | Tool configuration options                                                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts)                       |
| `ToolDefinition`                          | Provider-facing tool definition used for model/tool registration.                                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts)                       |
| `ToolExecutionContext`                    | Context passed to tool execution                                                                                                                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts)                       |
| `ToolExecutionDataEvent`                  | Event emitted for tool execution data.                                                                                                                                                      | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts)                       |
| `ToolSet`                                 | Runtime tool map keyed by the tool name exposed to an agent.                                                                                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/types.ts)                       |
| `TraceHostToolsOptions`                   | Options accepted by trace host tools.                                                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/tracing.ts)                     |

### Constants

| Name           | Description                                                                                                                                                                                           | Source                                                                               |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `sleepTool`    | Default sleep tool (max 60 s) exposed as a property accessor so the underlying `tool({...})` materialization is deferred until first use. Preserves the existing `sleepTool.execute(...)` call shape. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/sleep.ts)    |
| `toolRegistry` | Project-scoped tool registry value.                                                                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/tool/registry.ts) |
