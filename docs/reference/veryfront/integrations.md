---
title: "veryfront/integrations"
description: "Integration metadata and SVG icons for all connectors."
order: 22
---

# veryfront/integrations

Integration metadata and SVG icons for all connectors.

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
| `EnvVarSchema` | Zod schema for env var. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L73) |
| `IntegrationConfigSchema` | Zod schema for integration config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L203) |
| `IntegrationNameSchema` | Zod schema for integration name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L59) |
| `IntegrationPromptSchema` | Zod schema for integration prompt. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L177) |
| `IntegrationToolSchema` | Zod schema for integration tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L165) |
| `OAuthConfigSchema` | Zod schema for oauth config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L117) |
| `OAuthFieldSchema` | Zod schema for oauth field. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L86) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `executeRemoteIntegrationTool` | Execute a remote integration tool via the API. Called by the agent runtime when a tool isn't found in the local registry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/remote-tools.ts#L212) |
| `getConnector` | Return connector. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/index.ts#L50) |
| `getConnectorNames` | Return connector names. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/index.ts#L60) |
| `getIcon` | Return icon. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/index.ts#L65) |
| `getRemoteIntegrationToolDefinitions` | Fetch integration tool definitions for the current request context. Returns ToolDefinition[] that the agent runtime merges into the model's available tools. Returns empty array if no API config or no tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/remote-tools.ts#L173) |
| `isRemoteIntegrationTool` | Check if a tool name looks like a remote integration tool. Integration tools use "integration__tool_id" format (double underscore separator). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/remote-tools.ts#L201) |
| `listConnectors` | List connectors. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/index.ts#L55) |
| `syncIntegrationConfig` | Sync integration config from veryfront.config.ts to the API. This is a full-replace operation. Called by the MCP server path which has access to the config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/remote-tools.ts#L237) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `EnvVarConfig` | Configuration used by env var. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L208) |
| `IntegrationConfig` | Configuration used by integration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L218) |
| `IntegrationConnector` | Public API contract for integration connector. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/types.ts#L44) |
| `IntegrationName` | Public API contract for integration name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L206) |
| `IntegrationPrompt` | Public API contract for integration prompt. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L216) |
| `IntegrationRuntimeConfig` | Configuration used by integration runtime. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/types.ts#L59) |
| `IntegrationScope` | Public API contract for integration scope. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/types.ts#L56) |
| `IntegrationTool` | Public API contract for integration tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/types.ts#L35) |
| `IntegrationToolMeta` | Public API contract for integration tool meta. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L214) |
| `OAuthConfig` | Configuration used by oauth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L212) |
| `OAuthField` | Public API contract for oauth field. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L210) |

## Related

Reference modules:

- [`veryfront/oauth`](./oauth.md): OAuth 2.0 token management for integrations
- [`veryfront/tool`](./tool.md): Define tools that integrations expose
- [`veryfront/mcp`](./mcp.md): Expose integration tools via MCP

User guides:

- [integrations](../../guides/integrations.md): Connect SaaS integrations

Architecture:

- [19-integration-runtime](../../architecture/19-integration-runtime.md): Integration runtime
