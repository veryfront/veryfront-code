import type { IntegrationSelectedReadiness } from "./readiness.ts";
import type { BoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import type { IntegrationFailureCondition } from "./integration-condition.ts";

/** Data-only JSON retained without renaming provider fields. Response byte limits follow
 * the endpoint transport budget; authored arguments retain stricter generic limits. */
export type IntegrationJsonObject = { [key: string]: BoundedJsonValue };

/** Explicit caller-owned context. Credentials are never inferred from runtime globals. */
export interface IntegrationClientContext {
  /** Trusted HTTPS API origin supplied by the credential owner. */
  readonly apiBaseUrl: string;
  /** Explicit platform credential; never inferred from process or project state. */
  readonly authToken: string;
  /** An exact project UUID or slug. */
  readonly projectReference: string;
  /** Cancels construction and every operation performed by this client. */
  readonly abortSignal?: AbortSignal;
}

/** Integration catalog summary; additional native metadata is retained. */
export type IntegrationCatalogEntry = IntegrationJsonObject & {
  name: string;
  display_name: string;
  description: string;
  auth_type: string;
};

/** Connector setup requirements and native catalog details. */
export type IntegrationDetails = IntegrationJsonObject & {
  name: string;
  auth: IntegrationJsonObject;
  credential_requirement: IntegrationJsonObject;
};

/** Authored tool schema and native discovery metadata. */
export type IntegrationClientTool = IntegrationJsonObject & {
  name: string;
  description: string;
  inputSchema: IntegrationJsonObject;
};

/** A visible connection row, not an assertion of provider permission or tool readiness. */
export type IntegrationClientConnection = IntegrationJsonObject & {
  id: string;
  integration: string;
  connection_generation_id: string;
  scope: "user" | "project";
  status: "connected" | "expired" | "disconnected";
};

/** The existing OAuth status response, without invented readiness or expiry fields. */
export type IntegrationConnectionStatus = IntegrationJsonObject & {
  connected: boolean;
  integration: string;
  connection_id?: string;
  connection_generation_id?: string;
  connectionId?: string;
  connectionGenerationId?: string;
};

/** Native tool envelope, including multimedia, resources and extension metadata. */
export type IntegrationToolResult = IntegrationJsonObject & {
  content: IntegrationJsonObject[];
  structuredContent?: IntegrationJsonObject;
  isError?: boolean;
  _meta?: IntegrationJsonObject;
};

/** The native envelope is retained for both successful execution and tool failure. */
export type IntegrationCallOutcome =
  | { readonly status: "success"; readonly result: IntegrationToolResult }
  | {
    readonly status: "tool_error";
    readonly result: IntegrationToolResult;
    readonly condition?: IntegrationFailureCondition;
  };

/** Select a saved connection and optionally pin its observed generation. */
export interface IntegrationSelectionOptions {
  readonly connectionId?: string;
  /** Refuse replacement of the observed connection. Requires connectionId and server support. */
  readonly expectedConnectionGenerationId?: string;
  readonly abortSignal?: AbortSignal;
}

/**
 * Selection metadata for a tool call, separate from native provider arguments.
 * The API must advertise generation-precondition support. Unsupported deployments throw `IntegrationApiError` with kind `unsupported_precondition` and `outcomeUnknown: false` before dispatch. Missing confirmation after a successful
 * call response reports the same kind with `outcomeUnknown: true`. Calls never
 * authorize automatic replay. Omitting the generation retains existing call behavior.
 */
export interface IntegrationCallOptions extends IntegrationSelectionOptions {}

/** Connect options. Scope defaults to personal user ownership, never silently project scope. */
export interface IntegrationConnectOptions {
  readonly scope?: "user" | "project";
  /** Lazy allocation lets UI adapters start a callback receiver only for OAuth. */
  readonly redirectUri?: string | (() => string | Promise<string>);
  readonly abortSignal?: AbortSignal;
}

/** One-time browser handoff. connect_url is accessible but excluded from default serialization. */
export interface IntegrationOAuthHandoff {
  readonly status: "oauth_handoff";
  readonly integration: string;
  readonly project_id: string;
  readonly scope: "user" | "project";
  readonly connect_url: string;
  /** Exact one-time handoff expiry from the API, not an OAuth consent deadline. */
  readonly expires_at: string;
}

/** Catalog setup facts do not establish effective project credentials or tool readiness. */
export type IntegrationConnectOutcome = IntegrationOAuthHandoff | {
  readonly status: "setup_required" | "unsupported_auth";
  readonly integration: string;
  readonly details: IntegrationDetails;
};

/** Project-bound primitives. Iterators use a bounded deadline and fail rather than silently truncate. */
export interface IntegrationClient {
  readonly project: Readonly<{ id: string; slug: string }>;
  /** Read fresh selected-tool metadata. This neither executes a tool nor verifies provider access. */
  readiness(
    toolName: string,
    options?: IntegrationCallOptions,
  ): Promise<IntegrationSelectedReadiness>;
  discover(
    options?: { search?: string; sortOrder?: "asc" | "desc" },
  ): AsyncIterable<IntegrationCatalogEntry>;
  /** Read native connector setup requirements; this does not start consent. */
  getIntegration(integration: string): Promise<IntegrationDetails>;
  /** Traverse canonical tool schemas with the server-enforced project precondition. */
  listTools(
    integration: string,
    options?: { name?: string; order?: "asc" | "desc" },
  ): AsyncIterable<IntegrationClientTool>;
  /** Traverse visible connection metadata without selecting a different identity. */
  listConnections(
    integration: string,
    options?: { abortSignal?: AbortSignal },
  ): AsyncIterable<IntegrationClientConnection>;
  /** Start an API OAuth handoff or return catalog credential setup requirements. */
  connect(
    integration: string,
    options?: IntegrationConnectOptions,
  ): Promise<IntegrationConnectOutcome>;
  /** Read OAuth connectivity for an explicit scope, not executable readiness. */
  status(
    integration: string,
    scope: "user" | "project",
    options?: { abortSignal?: AbortSignal },
  ): Promise<IntegrationConnectionStatus>;
  call(
    toolName: string,
    args: Record<string, unknown>,
    options?: IntegrationCallOptions,
  ): Promise<IntegrationCallOutcome>;
}
