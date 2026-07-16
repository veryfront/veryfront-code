/**
 * Integration types for connector definitions fetched from the API.
 *
 * These mirror the API's REST response format (snake_case).
 */

export interface IntegrationEndpointParam {
  type: "string" | "number" | "boolean" | "string[]" | "object" | "array";
  in: "path" | "query" | "header" | "body";
  description: string;
  required?: boolean;
  default?: unknown;
  queryName?: string;
  queryValueFormat?: "microsoft-graph-search";
  headerName?: string;
}

interface IntegrationEndpointBodyField {
  type: "string" | "number" | "boolean" | "object" | "array";
  description: string;
  required?: boolean;
}

export type IntegrationHistoricalSummaryFieldKind =
  | "scalar"
  | "string-array"
  | "contact"
  | "contact-array";

export interface IntegrationHistoricalSummaryField {
  name: string;
  kind?: IntegrationHistoricalSummaryFieldKind;
  maxLength?: number;
}

export interface IntegrationHistoricalSummary {
  collection_keys: string[];
  collection_name: string;
  item_fields: IntegrationHistoricalSummaryField[];
  output_fields?: IntegrationHistoricalSummaryField[];
  omitted: string;
}

export interface IntegrationEndpoint {
  type?: "rest" | "graphql";
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  url: string;
  query?: string;
  params?: Record<string, IntegrationEndpointParam>;
  body?: Record<string, IntegrationEndpointBodyField>;
  contentType?: string;
  response?: {
    transform?: string;
    enrich?: {
      type: "gmail-message-metadata";
      url: string;
      idField?: string;
      metadataHeaders?: string[];
      maxItems?: number;
    };
    historical_summary?: IntegrationHistoricalSummary;
  };
}

/** Public API contract for integration tool. */
export interface IntegrationTool {
  id: string;
  name: string;
  description: string;
  requires_write: boolean;
  endpoint?: IntegrationEndpoint;
}

/** Public API contract for integration connector. */
export interface IntegrationConnector {
  name: string;
  display_name: string;
  description: string;
  auth: {
    type: "oauth2" | "api_key" | "none";
    provider?: string;
  };
  tools: IntegrationTool[];
}

/** Canonical user- or project-scoped integration connection. */
export type IntegrationScope = "user" | "project";

/** Configuration used by integration runtime. */
export interface IntegrationRuntimeConfig {
  /** Token scope. "project" = shared project token, "user" = private user token. */
  scope?: IntegrationScope;
  /** @deprecated Use `scope: "user"` instead. */
  perUser?: boolean;
  /** Allowlist of tool IDs to expose. When set, only these tools are registered. */
  tools?: string[];
}
