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

| Name | Description |
|------|-------------|
| `EnvVarSchema` | Validates environment variable configuration metadata |
| `IntegrationConfigSchema` | Validates complete integration connector configuration spec |
| `IntegrationNameSchema` | Validates integration name against allowed enum values |
| `IntegrationPromptSchema` | Validates predefined prompt configuration for integrations |
| `IntegrationToolSchema` | Validates tool definition from connector specification |
| `OAuthConfigSchema` | Validates OAuth/API key authentication configuration |
| `OAuthFieldSchema` | Validates OAuth form field configuration and mapping |

### Functions

| Name | Description |
|------|-------------|
| `executeRemoteIntegrationTool` | Execute a remote integration tool via the API. |
| `getConnector` | Look up connector config by name from registry |
| `getConnectorNames` | Return readonly array of all connector names |
| `getIcon` | Return SVG icon string for integration by name |
| `getRemoteIntegrationToolDefinitions` | Fetch integration tool definitions for the current request context. |
| `isRemoteIntegrationTool` | Check if a tool name looks like a remote integration tool. |
| `listConnectors` | Return readonly array of all connectors |
| `syncIntegrationConfig` | Sync integration config from veryfront.config.ts to the API. |

### Types

| Name | Description |
|------|-------------|
| `EnvVarConfig` | Environment variable requirement with metadata |
| `IntegrationConfig` | Complete connector spec: name, auth, tools, prompts |
| `IntegrationConnector` | Runtime connector with tools and endpoint definitions |
| `IntegrationName` | Union type of valid integration name literals |
| `IntegrationPrompt` | Predefined prompt template for integration use |
| `IntegrationRuntimeConfig` | Per-user settings and tool allowlist for integration |
| `IntegrationScope` |  |
| `IntegrationTool` | Integration tool with endpoint execution spec |
| `IntegrationToolMeta` | Tool metadata: name, description, write requirements |
| `OAuthConfig` | OAuth/API key authentication type and parameters |
| `OAuthField` | Form field for OAuth configuration with mapping |

## Related

Reference modules:

- [`veryfront/oauth`](./oauth.md): OAuth 2.0 token management for integrations
- [`veryfront/tool`](./tool.md): Define tools that integrations expose
- [`veryfront/mcp`](./mcp.md): Expose integration tools via MCP

User guides:

- [integrations](../../guides/integrations.md): Connect SaaS integrations

Architecture:

- [22-integration-runtime](../../architecture/22-integration-runtime.md): Integration runtime
