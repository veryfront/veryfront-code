---
title: "veryfront/integrations"
description: "Integration metadata and SVG icons for all connectors."
order: 14
---

## Import

```ts
import {
  createLocalIntegrationToolSource,
  createSalesforceServiceAccountToolSource,
  executeRemoteIntegrationTool,
  getConnector,
  getConnectorNames,
  getIcon,
} from "veryfront/integrations";
```

## Examples

```ts
import {
  createSalesforceServiceAccountToolSource,
  getConnector,
  getIcon,
  getRemoteIntegrationToolDefinitions,
  getRemoteIntegrationToolDiscovery,
  listConnectors,
} from "veryfront/integrations";

const connectors = listConnectors();
const slack = getConnector("slack");
const slackIcon = getIcon("slack"); // raw SVG string
const discovery = await getRemoteIntegrationToolDiscovery();
const runtimeTools = await getRemoteIntegrationToolDefinitions();
```

## Exports

### Components

| Name                                         | Description                                                                            | Source                                                                                                         |
| -------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `EnvVarSchema`                               | Zod schema for env var.                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts)                     |
| `IntegrationConfigSchema`                    | Zod schema for integration config.                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts)                     |
| `IntegrationEndpointHistoricalSummarySchema` |                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts)                     |
| `IntegrationNameSchema`                      | Zod schema for integration name.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts)                     |
| `IntegrationPromptSchema`                    | Zod schema for integration prompt.                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts)                     |
| `IntegrationToolSchema`                      | Zod schema for integration tool.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts)                     |
| `OAuthConfigSchema`                          | Zod schema for oauth config.                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts)                     |
| `OAuthFieldSchema`                           | Zod schema for oauth field.                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts)                     |
| `SALESFORCE_SERVICE_ACCOUNT_ENV_VARS`        | Project environment variables required by the local Salesforce service-account source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/salesforce-service-account.ts) |

### Functions

| Name                                       | Description                                                                                                                                                                                                                                                   | Source                                                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `createLocalIntegrationToolSource`         | Create an explicitly granted, catalog-backed local integration tool source.                                                                                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/local-tool-source.ts)          |
| `createSalesforceServiceAccountToolSource` | Create a local Salesforce service-account tool source.                                                                                                                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/salesforce-service-account.ts) |
| `executeRemoteIntegrationTool`             | Execute a remote integration tool via the API. Called by the agent runtime when a tool isn't found in the local registry. The request, response, and caller-supplied cancellation signal remain bounded for the complete network and response-body lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/remote-tools.ts)               |
| `getConnector`                             | Return connector.                                                                                                                                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/index.ts)                      |
| `getConnectorNames`                        | Return connector names.                                                                                                                                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/index.ts)                      |
| `getIcon`                                  | Return icon.                                                                                                                                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/index.ts)                      |
| `getRemoteIntegrationToolDefinitions`      | Fetch integration tool definitions for the current request context.                                                                                                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/remote-tools.ts)               |
| `getRemoteIntegrationToolDiscovery`        | Discover integration tools for the current request context.                                                                                                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/remote-tools.ts)               |
| `isRemoteIntegrationTool`                  | Check if a tool name looks like a remote integration tool. Integration tools use "integration__tool_id" format (double underscore separator).                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/remote-tools.ts)               |
| `listConnectors`                           | List connectors.                                                                                                                                                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/index.ts)                      |

### Types

| Name                                        | Description                                                                           | Source                                                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `EnvVarConfig`                              | Configuration used by env var.                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts)                     |
| `IntegrationConfig`                         | Configuration used by integration.                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts)                     |
| `IntegrationConnector`                      | Public API contract for integration connector.                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/types.ts)                      |
| `IntegrationEndpointHistoricalSummary`      | Provider-declared summary contract for old tool outputs kept actionable across turns. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts)                     |
| `IntegrationName`                           | Public API contract for integration name.                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts)                     |
| `IntegrationPrompt`                         | Public API contract for integration prompt.                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts)                     |
| `IntegrationTool`                           | Public API contract for integration tool.                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/types.ts)                      |
| `IntegrationToolMeta`                       | Public API contract for integration tool meta.                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts)                     |
| `LocalIntegrationCredentialProvider`        | Resolve one local integration credential by its canonical environment-variable name.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/local-tool-source.ts)          |
| `LocalIntegrationToolSourceOptions`         | Options for a catalog-backed local integration tool source.                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/local-tool-source.ts)          |
| `OAuthConfig`                               | Configuration used by oauth.                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts)                     |
| `OAuthField`                                | Public API contract for oauth field.                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts)                     |
| `RemoteIntegrationToolDiscoveryResult`      | Result of listing the integration tools available to the current run.                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/remote-tools.ts)               |
| `SalesforceServiceAccountToolSourceOptions` | Options for the local Salesforce service-account source.                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/salesforce-service-account.ts) |
