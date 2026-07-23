/**
 * Integration wire types for connector definitions returned by the API.
 *
 * These mirror the API's REST response format (snake_case).
 */

/** Endpoint parameter in the snake_case connector API response. */
export interface IntegrationEndpointParam {
  /** Primitive or collection value accepted by the endpoint. */
  type: "string" | "number" | "boolean" | "string[]" | "object" | "array";
  /** HTTP request location that receives the parameter. */
  in: "path" | "query" | "header" | "body";
  /** User-facing explanation of the parameter. */
  description: string;
  /** Whether callers must supply the parameter. */
  required?: boolean;
  /** Provider default returned by the API. */
  default?: unknown;
  /** Provider query name when it differs from the tool-facing name. */
  queryName?: string;
  /** Provider-specific query serialization behavior. */
  queryValueFormat?: "microsoft-graph-search";
  /** HTTP header name when it differs from the tool-facing name. */
  headerName?: string;
}

/** Endpoint body field in the connector API response. */
export interface IntegrationEndpointBodyField {
  /** Primitive or collection value accepted by the body field. */
  type: "string" | "number" | "boolean" | "object" | "array";
  /** User-facing explanation of the body field. */
  description: string;
  /** Whether callers must supply the body field. */
  required?: boolean;
}

/** Historical summary field shape returned by the connector API. */
export type IntegrationHistoricalSummaryFieldKind =
  | "scalar"
  | "string-array"
  | "contact"
  | "contact-array";

/** Field retained in a compact summary of a previous integration result. */
export interface IntegrationHistoricalSummaryField {
  /** Field name in the summarized result. */
  name: string;
  /** Serialization behavior applied to the field. */
  kind?: IntegrationHistoricalSummaryFieldKind;
  /** Maximum output length retained for the field. */
  maxLength?: number;
}

/** Compact historical summary contract returned by the connector API. */
export interface IntegrationHistoricalSummary {
  /** Candidate response keys that contain the result collection. */
  collection_keys: string[];
  /** Stable label for the summarized collection. */
  collection_name: string;
  /** Fields retained for each collection item. */
  item_fields: IntegrationHistoricalSummaryField[];
  /** Top-level fields retained alongside collection items. */
  output_fields?: IntegrationHistoricalSummaryField[];
  /** Message used when result details are omitted. */
  omitted: string;
}

/** Provider-specific enrichment applied to an endpoint response. */
export interface IntegrationEndpointResponseEnrichment {
  /** Supported enrichment implementation. */
  type: "gmail-message-metadata";
  /** HTTP endpoint queried for enrichment data. */
  url: string;
  /** Response field containing the item identifier. */
  idField?: string;
  /** Metadata headers retained by the enrichment. */
  metadataHeaders?: string[];
  /** Maximum number of response items enriched. */
  maxItems?: number;
}

/** Response processing contract in the connector API response. */
export interface IntegrationEndpointResponse {
  /** Provider response transformation source. */
  transform?: string;
  /** Optional provider-specific response enrichment. */
  enrich?: IntegrationEndpointResponseEnrichment;
  /** Historical summary contract in API wire format. */
  historical_summary?: IntegrationHistoricalSummary;
}

/** REST or GraphQL endpoint in the connector API response. */
export interface IntegrationEndpoint {
  /** Endpoint protocol. REST is used when omitted. */
  type?: "rest" | "graphql";
  /** HTTP method sent to the provider. */
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Provider endpoint URL. */
  url: string;
  /** GraphQL document sent by GraphQL endpoints. */
  query?: string;
  /** Tool parameters keyed by their tool-facing names. */
  params?: Record<string, IntegrationEndpointParam>;
  /** Request body fields keyed by their tool-facing names. */
  body?: Record<string, IntegrationEndpointBodyField>;
  /** Explicit content type used for the request body. */
  contentType?: string;
  /** Response processing contract. */
  response?: IntegrationEndpointResponse;
}

/** Integration tool in the snake_case connector API response. */
export interface IntegrationTool {
  /** Canonical integration-namespaced tool identifier. */
  id: string;
  /** User-facing tool name. */
  name: string;
  /** User-facing explanation of the tool behavior. */
  description: string;
  /** Whether the tool can mutate provider data. */
  requires_write: boolean;
  /** Provider endpoint executed by the tool. */
  endpoint?: IntegrationEndpoint;
}

/**
 * Connector in the snake_case API response format.
 *
 * Catalog helpers such as `getConnector()` return `IntegrationConfig`, which
 * is a separate camelCase runtime configuration contract.
 */
export interface IntegrationConnector {
  /** Canonical integration name. */
  name: string;
  /** User-facing integration name. */
  display_name: string;
  /** User-facing explanation of the integration. */
  description: string;
  /** Authentication method declared by the API payload. */
  auth: {
    /** Authentication strategy. */
    type: "oauth2" | "api_key" | "none";
    /** Provider identifier used by managed OAuth. */
    provider?: string;
  };
  /** Tools exposed by the connector. */
  tools: IntegrationTool[];
}
