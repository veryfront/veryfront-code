---
title: "veryfront/integrations"
description: "Integration metadata and SVG icons for all connectors."
order: 14
---

## Import

```ts
import {
  executeRemoteIntegrationTool,
  getConnector,
  getConnectorNames,
  getIcon,
  getRemoteIntegrationToolDefinitions,
  getRemoteIntegrationToolDiscovery,
} from "veryfront/integrations";
```

## Examples

```ts
import {
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

| Name                                         | Description                        | Source                                                                                          |
| -------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------- |
| `EnvVarSchema`                               | Zod schema for env var.            | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L235) |
| `IntegrationConfigSchema`                    | Zod schema for integration config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L480) |
| `IntegrationEndpointHistoricalSummarySchema` |                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L379) |
| `IntegrationNameSchema`                      | Zod schema for integration name.   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L214) |
| `IntegrationPromptSchema`                    | Zod schema for integration prompt. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L453) |
| `IntegrationToolSchema`                      | Zod schema for integration tool.   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L421) |
| `OAuthConfigSchema`                          | Zod schema for oauth config.       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L300) |
| `OAuthFieldSchema`                           | Zod schema for oauth field.        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L248) |

### Functions

| Name                                  | Description                                                                                                                                                                                                                                                   | Source                                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `executeRemoteIntegrationTool`        | Execute a remote integration tool via the API. Called by the agent runtime when a tool isn't found in the local registry. The request, response, and caller-supplied cancellation signal remain bounded for the complete network and response-body lifecycle. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/remote-tools.ts#L827) |
| `getConnector`                        | Return connector.                                                                                                                                                                                                                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/index.ts#L51)         |
| `getConnectorNames`                   | Return connector names.                                                                                                                                                                                                                                       | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/index.ts#L62)         |
| `getIcon`                             | Return icon.                                                                                                                                                                                                                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/index.ts#L67)         |
| `getRemoteIntegrationToolDefinitions` | Fetch integration tool definitions for the current request context.                                                                                                                                                                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/remote-tools.ts#L806) |
| `getRemoteIntegrationToolDiscovery`   | Discover integration tools for the current request context.                                                                                                                                                                                                   | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/remote-tools.ts#L757) |
| `isRemoteIntegrationTool`             | Check if a tool name looks like a remote integration tool. Integration tools use "integration__tool_id" format (double underscore separator).                                                                                                                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/remote-tools.ts#L817) |
| `listConnectors`                      | List connectors.                                                                                                                                                                                                                                              | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/index.ts#L57)         |

### Types

| Name                                   | Description                                                                           | Source                                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `EnvVarConfig`                         | Configuration used by env var.                                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L485)      |
| `IntegrationConfig`                    | Configuration used by integration.                                                    | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L499)      |
| `IntegrationConnector`                 | Public API contract for integration connector.                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/types.ts#L77)        |
| `IntegrationEndpointHistoricalSummary` | Provider-declared summary contract for old tool outputs kept actionable across turns. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L493)      |
| `IntegrationName`                      | Public API contract for integration name.                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L483)      |
| `IntegrationPrompt`                    | Public API contract for integration prompt.                                           | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L497)      |
| `IntegrationTool`                      | Public API contract for integration tool.                                             | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/types.ts#L68)        |
| `IntegrationToolMeta`                  | Public API contract for integration tool meta.                                        | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L491)      |
| `OAuthConfig`                          | Configuration used by oauth.                                                          | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L489)      |
| `OAuthField`                           | Public API contract for oauth field.                                                  | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L487)      |
| `RemoteIntegrationToolDiscoveryResult` | Result of listing the integration tools available to the current run.                 | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/remote-tools.ts#L84) |
