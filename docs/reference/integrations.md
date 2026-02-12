---
title: "veryfront/integrations"
description: "Integration metadata and SVG icons for all connectors."
order: 19
---

Integration metadata and SVG icons for all connectors.

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
| `EnvVarSchema` |  |
| `IntegrationConfigSchema` |  |
| `IntegrationNameSchema` |  |
| `IntegrationPromptSchema` |  |
| `IntegrationToolSchema` |  |
| `OAuthConfigSchema` |  |
| `OAuthFieldSchema` |  |

### Functions

| Name | Description |
|------|-------------|
| `clearConnectorCache` | Clear the connector cache (for testing). |
| `createIntegrationTools` |  |
| `executeEndpoint` |  |
| `fetchConnector` |  |
| `getConnector` |  |
| `getConnectorNames` |  |
| `getIcon` |  |
| `listConnectors` |  |
| `registerIntegrationMCP` | Register integration tools into the MCP tool registry. |

### Types

| Name | Description |
|------|-------------|
| `EnvVarConfig` |  |
| `IntegrationConfig` |  |
| `IntegrationConnector` |  |
| `IntegrationMCPConfig` |  |
| `IntegrationName` |  |
| `IntegrationPrompt` |  |
| `IntegrationRuntimeConfig` |  |
| `IntegrationTool` |  |
| `IntegrationToolMeta` |  |
| `OAuthConfig` |  |
| `OAuthField` |  |
