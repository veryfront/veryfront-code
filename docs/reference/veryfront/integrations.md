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
| `EnvVarSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L70) |
| `IntegrationConfigSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L195) |
| `IntegrationNameSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L57) |
| `IntegrationPromptSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L170) |
| `IntegrationToolSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L159) |
| `OAuthConfigSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L112) |
| `OAuthFieldSchema` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L82) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `executeRemoteIntegrationTool` | Execute a remote integration tool via the API. Called by the agent runtime when a tool isn't found in the local registry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/remote-tools.ts#L211) |
| `getConnector` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/index.ts#L48) |
| `getConnectorNames` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/index.ts#L56) |
| `getIcon` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/index.ts#L60) |
| `getRemoteIntegrationToolDefinitions` | Fetch integration tool definitions for the current request context. Returns ToolDefinition[] that the agent runtime merges into the model's available tools. Returns empty array if no API config or no tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/remote-tools.ts#L172) |
| `isRemoteIntegrationTool` | Check if a tool name looks like a remote integration tool. Integration tools use "integration__tool_id" format (double underscore separator). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/remote-tools.ts#L200) |
| `listConnectors` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/index.ts#L52) |
| `syncIntegrationConfig` | Sync integration config from veryfront.config.ts to the API. This is a full-replace operation. Called by the MCP server path which has access to the config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/remote-tools.ts#L236) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `EnvVarConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L198) |
| `IntegrationConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L203) |
| `IntegrationConnector` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/types.ts#L41) |
| `IntegrationName` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L197) |
| `IntegrationPrompt` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L202) |
| `IntegrationRuntimeConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/types.ts#L54) |
| `IntegrationScope` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/types.ts#L52) |
| `IntegrationTool` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/types.ts#L33) |
| `IntegrationToolMeta` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L201) |
| `OAuthConfig` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L200) |
| `OAuthField` |  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L199) |

## Related

Reference modules:

- [`veryfront/oauth`](./oauth.md): OAuth 2.0 token management for integrations
- [`veryfront/tool`](./tool.md): Define tools that integrations expose
- [`veryfront/mcp`](./mcp.md): Expose integration tools via MCP

User guides:

- [integrations](../../guides/integrations.md): Connect SaaS integrations

Architecture:

- [19-integration-runtime](../../architecture/19-integration-runtime.md): Integration runtime
