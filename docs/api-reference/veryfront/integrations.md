---
title: "veryfront/integrations"
description: "Integration metadata and SVG icons for all connectors."
order: 11
---

## Import

```ts
import {
  executeRemoteIntegrationTool,
  getConnector,
  getConnectorNames,
  getIcon,
  getRemoteIntegrationToolDefinitions,
  isRemoteIntegrationTool,
} from "veryfront/integrations";
```

## Examples

```ts
import {
  getConnector,
  getIcon,
  getRemoteIntegrationToolDefinitions,
  listConnectors,
} from "veryfront/integrations";

const connectors = listConnectors();
const slack = getConnector("slack");
const slackIcon = getIcon("slack"); // raw SVG string
const runtimeTools = await getRemoteIntegrationToolDefinitions();
```

## Exports

### Components

| Name | Description | Source |
|------|-------------|--------|
| `EnvVarSchema` | Zod schema for env var. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L70) |
| `IntegrationConfigSchema` | Zod schema for integration config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L242) |
| `IntegrationEndpointHistoricalSummarySchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L171) |
| `IntegrationNameSchema` | Zod schema for integration name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L56) |
| `IntegrationPromptSchema` | Zod schema for integration prompt. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L216) |
| `IntegrationToolSchema` | Zod schema for integration tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L204) |
| `OAuthConfigSchema` | Zod schema for oauth config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L114) |
| `OAuthFieldSchema` | Zod schema for oauth field. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L83) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `executeRemoteIntegrationTool` | Execute a remote integration tool via the API. Called by the agent runtime when a tool isn't found in the local registry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/remote-tools.ts#L202) |
| `getConnector` | Return connector. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/index.ts#L49) |
| `getConnectorNames` | Return connector names. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/index.ts#L60) |
| `getIcon` | Return icon. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/index.ts#L65) |
| `getRemoteIntegrationToolDefinitions` | Fetch integration tool definitions for the current request context. Returns ToolDefinition[] that the agent runtime merges into the model's available tools. Returns empty array if no API config or no tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/remote-tools.ts#L163) |
| `isRemoteIntegrationTool` | Check if a tool name looks like a remote integration tool. Integration tools use "integration__tool_id" format (double underscore separator). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/remote-tools.ts#L191) |
| `listConnectors` | List connectors. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/index.ts#L55) |
| `syncIntegrationConfig` | Sync integration config from veryfront.config.ts to the API. This is a full-replace operation. Called by the MCP server path which has access to the config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/remote-tools.ts#L227) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `EnvVarConfig` | Configuration used by env var. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L247) |
| `IntegrationConfig` | Configuration used by integration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L261) |
| `IntegrationConnector` | Public API contract for integration connector. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/types.ts#L72) |
| `IntegrationEndpointHistoricalSummary` | Provider-declared summary contract for old tool outputs kept actionable across turns. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L255) |
| `IntegrationName` | Public API contract for integration name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L245) |
| `IntegrationPrompt` | Public API contract for integration prompt. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L259) |
| `IntegrationRuntimeConfig` | Configuration used by integration runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/types.ts#L87) |
| `IntegrationScope` | Public API contract for integration scope. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/types.ts#L84) |
| `IntegrationTool` | Public API contract for integration tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/types.ts#L63) |
| `IntegrationToolMeta` | Public API contract for integration tool meta. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L253) |
| `OAuthConfig` | Configuration used by oauth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L251) |
| `OAuthField` | Public API contract for oauth field. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L249) |
