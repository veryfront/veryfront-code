---
title: "veryfront/integrations"
description: "Integration metadata and SVG icons for all connectors."
order: 12
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
| `EnvVarSchema` | Zod schema for env var. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L363) |
| `IntegrationConfigSchema` | Zod schema for integration config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L849) |
| `IntegrationEndpointHistoricalSummarySchema` | Validates provider-declared summaries used to retain compact historical tool results. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L604) |
| `IntegrationNameSchema` | Zod schema for integration name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L339) |
| `IntegrationPromptSchema` | Zod schema for integration prompt. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L772) |
| `IntegrationToolSchema` | Zod schema for integration tool. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L732) |
| `OAuthConfigSchema` | Zod schema for oauth config. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L490) |
| `OAuthFieldSchema` | Zod schema for oauth field. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L376) |

### Functions

| Name | Description | Source |
|------|-------------|--------|
| `executeRemoteIntegrationTool` | Execute a remote integration tool via the API. Called by the agent runtime when a tool isn't found in the local registry. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/remote-tools.ts#L546) |
| `getConnector` | Return a visible connector by name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/index.ts#L72) |
| `getConnectorNames` | Return visible connector names. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/index.ts#L84) |
| `getIcon` | Return a visible connector's SVG icon. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/index.ts#L89) |
| `getRemoteIntegrationToolDefinitions` | Fetch integration tool definitions for the current request context. Returns ToolDefinition[] that the agent runtime merges into the model's available tools. Returns empty array if no API config or no tools. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/remote-tools.ts#L506) |
| `isRemoteIntegrationTool` | Check if a tool name looks like a remote integration tool. Integration tools use "integration__tool_id" format (double underscore separator). | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/remote-tools.ts#L538) |
| `listConnectors` | List visible connectors. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/index.ts#L79) |

### Types

| Name | Description | Source |
|------|-------------|--------|
| `EnvVarConfig` | Configuration used by env var. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L854) |
| `IntegrationConfig` | Configuration used by integration. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L868) |
| `IntegrationConnector` | Connector in the snake_case API response format. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/types.ts#L132) |
| `IntegrationEndpoint` | REST or GraphQL endpoint in the connector API response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/types.ts#L93) |
| `IntegrationEndpointBodyField` | Endpoint body field in the connector API response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/types.ts#L28) |
| `IntegrationEndpointHistoricalSummary` | Provider-declared summary contract for old tool outputs kept actionable across turns. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L862) |
| `IntegrationEndpointParam` | Endpoint parameter in the snake_case connector API response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/types.ts#L8) |
| `IntegrationEndpointResponse` | Response processing contract in the connector API response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/types.ts#L83) |
| `IntegrationEndpointResponseEnrichment` | Provider-specific enrichment applied to an endpoint response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/types.ts#L69) |
| `IntegrationHistoricalSummary` | Compact historical summary contract returned by the connector API. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/types.ts#L55) |
| `IntegrationHistoricalSummaryField` | Field retained in a compact summary of a previous integration result. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/types.ts#L45) |
| `IntegrationHistoricalSummaryFieldKind` | Historical summary field shape returned by the connector API. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/types.ts#L38) |
| `IntegrationName` | Public API contract for integration name. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L852) |
| `IntegrationPrompt` | Public API contract for integration prompt. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L866) |
| `IntegrationTool` | Integration tool in the snake_case connector API response. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/types.ts#L113) |
| `IntegrationToolMeta` | Public API contract for integration tool meta. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L860) |
| `OAuthConfig` | Configuration used by oauth. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L858) |
| `OAuthField` | Public API contract for oauth field. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/schema.ts#L856) |
| `RemoteIntegrationToolDefinition` | Provider-facing definition discovered from the integration tools API. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/remote-tools.ts#L81) |
| `RemoteIntegrationToolExecutionContext` | Request metadata forwarded when a remote integration tool executes. | [source](https://github.com/veryfront/veryfront-code/blob/main/src/integrations/remote-tools.ts#L91) |
