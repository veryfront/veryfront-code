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

| Name                                         | Description                                                                            | Source                                                                                                             |
| -------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `EnvVarSchema`                               | Zod schema for env var.                                                                | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L235)                    |
| `IntegrationConfigSchema`                    | Zod schema for integration config.                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L483)                    |
| `IntegrationEndpointHistoricalSummarySchema` |                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L382)                    |
| `IntegrationNameSchema`                      | Zod schema for integration name.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L214)                    |
| `IntegrationPromptSchema`                    | Zod schema for integration prompt.                                                     | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L456)                    |
| `IntegrationToolSchema`                      | Zod schema for integration tool.                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L424)                    |
| `OAuthConfigSchema`                          | Zod schema for oauth config.                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L300)                    |
| `OAuthFieldSchema`                           | Zod schema for oauth field.                                                            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L248)                    |
| `SALESFORCE_SERVICE_ACCOUNT_ENV_VARS`        | Project environment variables required by the local Salesforce service-account source. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/salesforce-service-account.ts#L26) |

### Functions

| Name                                       | Description                                                                                                                                                                                                                                                   | Source                                                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `createLocalIntegrationToolSource`         | Create an explicitly granted, catalog-backed local integration tool source.                                                                                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/local-tool-source.ts#L741)           |
| `createSalesforceServiceAccountToolSource` | Create a local Salesforce service-account tool source.                                                                                                                                                                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/salesforce-service-account.ts#L1039) |
| `executeRemoteIntegrationTool`             | Execute a remote integration tool via the API. Called by the agent runtime when a tool isn't found in the local registry. The request, response, and caller-supplied cancellation signal remain bounded for the complete network and response-body lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/remote-tools.ts#L829)                |
| `getConnector`                             | Return connector.                                                                                                                                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/index.ts#L52)                        |
| `getConnectorNames`                        | Return connector names.                                                                                                                                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/index.ts#L63)                        |
| `getIcon`                                  | Return icon.                                                                                                                                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/index.ts#L68)                        |
| `getRemoteIntegrationToolDefinitions`      | Fetch integration tool definitions for the current request context.                                                                                                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/remote-tools.ts#L807)                |
| `getRemoteIntegrationToolDiscovery`        | Discover integration tools for the current request context.                                                                                                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/remote-tools.ts#L758)                |
| `isRemoteIntegrationTool`                  | Check if a tool name looks like a remote integration tool. Integration tools use "integration__tool_id" format (double underscore separator).                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/remote-tools.ts#L818)                |
| `listConnectors`                           | List connectors.                                                                                                                                                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/index.ts#L58)                        |

### Types

| Name                                        | Description                                                                           | Source                                                                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `EnvVarConfig`                              | Configuration used by env var.                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L488)                    |
| `IntegrationConfig`                         | Configuration used by integration.                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L502)                    |
| `IntegrationConnector`                      | Public API contract for integration connector.                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/types.ts#L78)                      |
| `IntegrationEndpointHistoricalSummary`      | Provider-declared summary contract for old tool outputs kept actionable across turns. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L496)                    |
| `IntegrationName`                           | Public API contract for integration name.                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L486)                    |
| `IntegrationPrompt`                         | Public API contract for integration prompt.                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L500)                    |
| `IntegrationTool`                           | Public API contract for integration tool.                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/types.ts#L69)                      |
| `IntegrationToolMeta`                       | Public API contract for integration tool meta.                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L494)                    |
| `LocalIntegrationCredentialProvider`        | Resolve one local integration credential by its canonical environment-variable name.  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/local-tool-source.ts#L67)          |
| `LocalIntegrationToolSourceOptions`         | Options for a catalog-backed local integration tool source.                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/local-tool-source.ts#L72)          |
| `OAuthConfig`                               | Configuration used by oauth.                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L492)                    |
| `OAuthField`                                | Public API contract for oauth field.                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L490)                    |
| `RemoteIntegrationToolDiscoveryResult`      | Result of listing the integration tools available to the current run.                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/remote-tools.ts#L86)               |
| `SalesforceServiceAccountToolSourceOptions` | Options for the local Salesforce service-account source.                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/salesforce-service-account.ts#L42) |
