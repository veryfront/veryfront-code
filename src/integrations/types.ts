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
}

interface IntegrationEndpointBodyField {
  type: "string" | "number" | "boolean" | "object" | "array";
  description: string;
  required?: boolean;
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
  };
}

export interface IntegrationTool {
  id: string;
  name: string;
  description: string;
  requires_write: boolean;
  endpoint?: IntegrationEndpoint;
}

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

export interface IntegrationRuntimeConfig {
  perUser?: boolean;
  /** Allowlist of tool IDs to expose. When set, only these tools are registered. */
  tools?: string[];
}
