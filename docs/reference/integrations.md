---
title: "veryfront/integrations"
description: "Integration metadata and SVG icons for all connectors."
order: 19
---

## Import

```ts
import {
  clearConnectorCache,
  createIntegrationTools,
  executeEndpoint,
  fetchConnector,
  getConnector,
  getConnectorNames,
} from "veryfront/integrations";
```

## Examples

```ts
import { listConnectors, getIcon } from "veryfront/integrations";

const connectors = listConnectors();
const slackIcon = getIcon("slack"); // raw SVG string
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
| `clearConnectorCache` | Clear the connector cache (for testing). |
| `createIntegrationTools` | Generate Tool instances from connector specifications |
| `executeEndpoint` | Execute REST or GraphQL endpoints with authentication |
| `fetchConnector` | Fetch connector spec from API with LRU caching |
| `getConnector` | Look up connector config by name from registry |
| `getConnectorNames` | Return readonly array of all connector names |
| `getIcon` | Return SVG icon string for integration by name |
| `listConnectors` | Return readonly array of all connectors |
| `registerIntegrationMCP` | Register integration tools into the MCP tool registry. |

### Types

| Name | Description |
|------|-------------|
| `EnvVarConfig` | Environment variable requirement with metadata |
| `IntegrationConfig` | Complete connector spec: name, auth, tools, prompts |
| `IntegrationConnector` | Runtime connector with tools and endpoint definitions |
| `IntegrationMCPConfig` | Configuration for registering integrations into MCP |
| `IntegrationName` | Union type of valid integration name literals |
| `IntegrationPrompt` | Predefined prompt template for integration use |
| `IntegrationRuntimeConfig` | Per-user settings and tool allowlist for integration |
| `IntegrationTool` | Integration tool with endpoint execution spec |
| `IntegrationToolMeta` | Tool metadata: name, description, write requirements |
| `OAuthConfig` | OAuth/API key authentication type and parameters |
| `OAuthField` | Form field for OAuth configuration with mapping |

## Related

- [`veryfront/oauth`](./oauth.md) — OAuth 2.0 token management for integrations
- [`veryfront/tool`](./tool.md) — Define tools that integrations expose
- [`veryfront/mcp`](./mcp.md) — Expose integration tools via MCP
