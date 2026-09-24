import {
  API_CLIENT_ERROR,
  defineError,
  getAllSlugs,
  getErrorBySlug,
  VeryfrontError,
} from "#veryfront/errors";
import { createVeryfrontApiRequestUrlResolver } from "#veryfront/platform/adapters/veryfront-api-url.ts";
import { requireHostPrivateApiHttps } from "#veryfront/config/host-api-base.ts";
import {
  snapshotBoundedJsonValue,
  snapshotBoundedParsedJsonValue,
} from "#veryfront/schemas/json-value.ts";
import { isCanonicalProjectSlug } from "#veryfront/utils/project-identity.ts";
import { parseIntegrationToolIdentity } from "./source-policy.ts";
import {
  createIntegrationRequestSignalScope,
  discardResponseBody,
  dispatchIntegrationApiRequest,
  isValidIntegrationApiToken,
  readBoundedResponseJson,
} from "./integration-transport.ts";
import {
  type IntegrationFailureCondition,
  type IntegrationHttpProblem,
  readIntegrationFailureCondition,
  readIntegrationHttpProblem,
} from "./integration-condition.ts";
import {
  MAX_INTEGRATION_API_ERROR_RESPONSE_BYTES,
  MAX_INTEGRATION_CALL_REQUEST_BYTES,
  MAX_INTEGRATION_PAGINATION_CURSOR_LENGTH,
  MAX_INTEGRATION_PAGINATION_PAGES,
  MAX_INTEGRATION_TOOL_CALL_RESPONSE_BYTES,
  MAX_INTEGRATION_TOOL_LIST_RESPONSE_BYTES,
  MAX_REMOTE_INTEGRATION_TOOL_NAME_LENGTH,
} from "./limits.ts";
import type {
  IntegrationCallOptions,
  IntegrationCatalogEntry,
  IntegrationClient,
  IntegrationClientConnection,
  IntegrationClientContext,
  IntegrationClientTool,
  IntegrationConnectionStatus,
  IntegrationConnectOptions,
  IntegrationConnectOutcome,
  IntegrationDetails,
  IntegrationJsonObject,
  IntegrationOAuthHandoff,
  IntegrationToolResult,
} from "./client-types.ts";

/** A bounded API failure. Call failures never authorize automatic replay. */

import { createIntegrationErrorContext } from "./error-context.ts";
export class IntegrationApiError extends VeryfrontError {
  override readonly name = "IntegrationApiError";
  /** Conservative client replay policy, not a server retryability declaration. */
  readonly retryable = false;
  readonly httpProblem?: IntegrationHttpProblem;
  readonly problem?: IntegrationJsonObject;
  constructor(
    readonly kind: "http" | "transport" | "invalid_response" | "project_binding",
    readonly httpStatus: number | undefined,
    readonly outcomeUnknown: boolean,
    readonly condition?: IntegrationFailureCondition,
    problem?: IntegrationJsonObject,
  ) {
    const httpProblem = readIntegrationHttpProblem(problem);
    const registeredSlug = getAllSlugs().find((slug) => slug === httpProblem?.slug);
    const existing = registeredSlug ? getErrorBySlug(registeredSlug) : API_CLIENT_ERROR;
    const definition = defineError({
      slug: httpProblem?.slug ?? existing.slug,
      category: existing.category,
      status: httpStatus !== undefined && httpStatus >= 400 ? httpStatus : existing.status,
      title: existing.title,
      suggestion: outcomeUnknown
        ? "Check the provider outcome before retrying this operation"
        : existing.suggestion,
      ...(existing.exitCode === undefined ? {} : { exitCode: existing.exitCode }),
    });
    super(
      kind === "http"
        ? `Integration API request failed (${httpStatus})`
        : `Integration API ${kind.replaceAll("_", " ")} failure`,
      {
        ...definition,
        context: createIntegrationErrorContext({
          kind,
          outcomeUnknown,
          ...(httpStatus === undefined ? {} : { httpStatus }),
          ...(httpProblem ? { httpProblem } : {}),
          ...(condition ? { condition } : {}),
        }),
      },
    );
    this.httpProblem = httpProblem;
    if (problem) Object.defineProperty(this, "problem", { value: problem, enumerable: false });
  }
}

function record(value: unknown): value is IntegrationJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function projectSlug(value: unknown): value is string {
  return typeof value === "string" && isCanonicalProjectSlug(value);
}
function identifier(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(value);
}
function uuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
function integrationPath(integration: string): string {
  if (!identifier(integration)) throw new TypeError("Integration must be a canonical identifier");
  return encodeURIComponent(integration);
}
function boundedObject(value: unknown, responseBytes?: number): IntegrationJsonObject {
  const snapshot = responseBytes === undefined
    ? snapshotBoundedJsonValue(value)
    : snapshotBoundedParsedJsonValue(value, responseBytes);
  if (!snapshot.success || !record(snapshot.value)) {
    throw new TypeError("Expected a bounded JSON object without accessors or cycles");
  }
  return snapshot.value;
}
function snapshotContext(input: IntegrationClientContext): IntegrationClientContext {
  if (!record(input)) throw new TypeError("Integration client context must be an object");
  const get = (name: string): unknown => {
    const property = Reflect.getOwnPropertyDescriptor(input, name);
    if (property && !("value" in property)) {
      throw new TypeError("Integration client context requires data properties");
    }
    return property?.value;
  };
  const authToken = get("authToken");
  if (!isValidIntegrationApiToken(authToken)) {
    throw new TypeError("A valid explicit API credential is required");
  }
  const apiBaseUrl = get("apiBaseUrl");
  if (typeof apiBaseUrl !== "string") {
    throw new TypeError("An explicit HTTPS API origin is required");
  }
  requireHostPrivateApiHttps(apiBaseUrl);
  const projectReference = get("projectReference");
  if (!projectSlug(projectReference) && !uuid(projectReference)) {
    throw new TypeError("An explicit project UUID or slug is required");
  }
  const abortSignal = get("abortSignal");
  if (abortSignal !== undefined && !(abortSignal instanceof AbortSignal)) {
    throw new TypeError("abortSignal must be an AbortSignal");
  }
  return Object.freeze({ apiBaseUrl, authToken, projectReference, abortSignal });
}
function parseToolResult(value: unknown): IntegrationToolResult {
  if (
    !record(value) || !Array.isArray(value.content) ||
    value.content.some((item) => !record(item) || typeof item.type !== "string") ||
    (value.structuredContent !== undefined && !record(value.structuredContent)) ||
    (value._meta !== undefined && !record(value._meta)) ||
    (value.isError !== undefined && typeof value.isError !== "boolean")
  ) {
    throw new IntegrationApiError("invalid_response", 200, true);
  }
  return value as IntegrationToolResult;
}
function requireShape<T extends IntegrationJsonObject>(
  value: unknown,
  valid: (item: IntegrationJsonObject) => boolean,
): T {
  if (!record(value) || !valid(value)) {
    throw new IntegrationApiError("invalid_response", 200, false);
  }
  return value as T;
}
function nextCursor(page: IntegrationJsonObject, legacyTools: boolean): string | undefined {
  if (page.page_info === undefined && legacyTools && page.total === undefined) return undefined;
  if (!record(page.page_info) || !("next" in page.page_info)) {
    throw new IntegrationApiError("invalid_response", 200, false);
  }
  const next = page.page_info.next;
  if (next === null) return undefined;
  if (
    typeof next !== "string" || next.length === 0 ||
    next.length > MAX_INTEGRATION_PAGINATION_CURSOR_LENGTH
  ) {
    throw new IntegrationApiError("invalid_response", 200, false);
  }
  return next;
}

/**
 * Bind explicit API credentials and an authorized project for catalog, status and tool calls.
 * Requires the API expected-project precondition and effective-project response header contract.
 * This client does not infer consent completion or executable readiness from connected status.
 */
export async function createIntegrationClient(
  input: IntegrationClientContext,
): Promise<IntegrationClient> {
  const context = snapshotContext(input);
  const resolveUrl = createVeryfrontApiRequestUrlResolver(context.apiBaseUrl);
  // Bound only after the authorized project preflight completes.
  let project: Readonly<{ id: string; slug: string }> | undefined = undefined;

  async function request(path: string, options: {
    method?: "GET" | "POST";
    body?: string;
    signal?: AbortSignal | undefined;
    execution?: boolean;
    requireProjectBinding?: boolean;
  } = {}): Promise<IntegrationJsonObject> {
    const {
      method = "GET",
      body,
      signal: operationSignal,
      execution: call = false,
      requireProjectBinding = false,
    } = options;
    const signal = context.abortSignal && operationSignal
      ? AbortSignal.any([context.abortSignal, operationSignal])
      : context.abortSignal ?? operationSignal;
    signal?.throwIfAborted();
    if (requireProjectBinding && !project) {
      throw new TypeError("Resolve the project before requesting integration tools");
    }
    const scope = createIntegrationRequestSignalScope(signal);
    let response: Response | undefined;
    try {
      response = await dispatchIntegrationApiRequest({
        requestUrl: resolveUrl(path),
        token: context.authToken,
        serializedBody: body,
        projectSlug: project?.slug,
        expectedProjectId: requireProjectBinding ? project?.id : undefined,
        signal: scope.signal,
        method,
        redirect: "error",
      });
      if (!response.ok) {
        let condition: IntegrationFailureCondition | undefined;
        let problem: IntegrationJsonObject | undefined;
        try {
          const error = await readBoundedResponseJson(
            response,
            MAX_INTEGRATION_API_ERROR_RESPONSE_BYTES,
            scope.signal,
            "Integration API error",
          );
          problem = boundedObject(error, MAX_INTEGRATION_API_ERROR_RESPONSE_BYTES);
          condition = readIntegrationFailureCondition(problem);
        } catch { /* Error body text is not retained in diagnostics. */ }
        throw new IntegrationApiError(
          "http",
          response.status,
          call && (response.status >= 500 || response.status === 408 ||
            readIntegrationHttpProblem(problem)?.slug === "integration-execution-outcome-unknown"),
          condition,
          problem,
        );
      }
      const effectiveProject = response.headers.get("x-veryfront-project-id");
      if (
        project && ((requireProjectBinding && effectiveProject === null) ||
          (effectiveProject !== null &&
            (!uuid(effectiveProject) || effectiveProject.toLowerCase() !== project.id)))
      ) {
        discardResponseBody(response);
        throw new IntegrationApiError("project_binding", response.status, call);
      }
      const value = await readBoundedResponseJson(
        response,
        call ? MAX_INTEGRATION_TOOL_CALL_RESPONSE_BYTES : MAX_INTEGRATION_TOOL_LIST_RESPONSE_BYTES,
        scope.signal,
        "Integration API response",
      );
      return boundedObject(
        value,
        call ? MAX_INTEGRATION_TOOL_CALL_RESPONSE_BYTES : MAX_INTEGRATION_TOOL_LIST_RESPONSE_BYTES,
      );
    } catch (error) {
      if (error instanceof IntegrationApiError) throw error;
      if (scope.signal.aborted) {
        if (!call) throw scope.signal.reason;
        throw new IntegrationApiError("transport", response?.status, true);
      }
      throw new IntegrationApiError(
        response ? "invalid_response" : "transport",
        response?.status,
        call,
      );
    } finally {
      scope.dispose();
    }
  }

  const resolved = await request(
    `/projects/${encodeURIComponent(context.projectReference)}`,
  );
  if (
    !uuid(resolved.id) || !projectSlug(resolved.slug) ||
    (uuid(context.projectReference)
      ? context.projectReference.toLowerCase() !== resolved.id.toLowerCase()
      : context.projectReference !== resolved.slug)
  ) {
    throw new TypeError("API returned a different or invalid project identity");
  }
  const selectedProject = Object.freeze({ id: resolved.id.toLowerCase(), slug: resolved.slug });
  project = selectedProject;
  // Accessible project detail alone does not establish a token's tool binding.
  // The read-only discovery handler publishes the same authoritative project
  // selection used by calls, including project-bound credential precedence.
  const binding = await request("/integrations/tools/list?limit=1", {
    method: "POST",
    requireProjectBinding: true,
  });
  if (!Array.isArray(binding.tools)) throw new IntegrationApiError("invalid_response", 200, false);

  async function* pages<T extends IntegrationJsonObject>(
    path: string,
    key: "data" | "tools",
    query: Record<string, string>,
    valid: (item: IntegrationJsonObject) => boolean,
    abortSignal?: AbortSignal,
  ): AsyncIterable<T> {
    const scope = createIntegrationRequestSignalScope(
      abortSignal && context.abortSignal
        ? AbortSignal.any([abortSignal, context.abortSignal])
        : abortSignal ?? context.abortSignal,
    );
    const seen = new Set<string>();
    let cursor: string | undefined;
    let pageCount = 0;
    try {
      do {
        scope.signal.throwIfAborted();
        if (++pageCount > MAX_INTEGRATION_PAGINATION_PAGES) {
          throw new RangeError("Integration pagination exceeded its page limit");
        }
        const params = new URLSearchParams({
          ...query,
          limit: "100",
          ...(cursor ? { cursor } : {}),
        });
        const page = await request(`${path}?${params}`, {
          // Every paginated endpoint used by this client is an audited GET route.
          method: "GET",
          signal: scope.signal,
          requireProjectBinding: key === "tools",
        });
        if (!Array.isArray(page[key])) {
          throw new IntegrationApiError("invalid_response", 200, false);
        }
        const next = nextCursor(page, key === "tools");
        if (next && seen.has(next)) throw new Error("Integration API repeated a pagination cursor");
        if (next) seen.add(next);
        for (const item of page[key]) {
          scope.signal.throwIfAborted();
          yield requireShape<T>(item, valid);
        }
        cursor = next;
      } while (cursor);
    } finally {
      scope.dispose();
    }
  }

  async function getDetails(
    integration: string,
    signal?: AbortSignal,
  ): Promise<IntegrationDetails> {
    return requireShape<IntegrationDetails>(
      await request(`/integrations/${integrationPath(integration)}`, { signal }),
      (item) =>
        item.name === integration && record(item.auth) && record(item.credential_requirement),
    );
  }

  return Object.freeze({
    project: selectedProject,
    discover(options: { search?: string; sortOrder?: "asc" | "desc" } = {}) {
      return pages<IntegrationCatalogEntry>(
        "/integrations",
        "data",
        {
          sort_by: "name",
          sort_order: options.sortOrder ?? "asc",
          ...(options.search ? { search: options.search } : {}),
        },
        (item) =>
          identifier(item.name) && typeof item.display_name === "string" &&
          typeof item.description === "string" && typeof item.auth_type === "string",
      );
    },
    getIntegration: getDetails,
    async connect(
      integration: string,
      options: IntegrationConnectOptions = {},
    ): Promise<IntegrationConnectOutcome> {
      const scope = options.scope ?? "user";
      if (scope !== "user" && scope !== "project") {
        throw new TypeError("Connection scope must be user or project");
      }
      context.abortSignal?.throwIfAborted();
      options.abortSignal?.throwIfAborted();
      const signal = context.abortSignal && options.abortSignal
        ? AbortSignal.any([context.abortSignal, options.abortSignal])
        : context.abortSignal ?? options.abortSignal;
      const details = await getDetails(integration, signal);
      signal?.throwIfAborted();
      const mode = details.credential_requirement.mode;
      if (mode !== "oauth_connection") {
        return {
          status: mode === "project_credentials" ? "setup_required" : "unsupported_auth",
          integration,
          details,
        };
      }
      const redirectUri = typeof options.redirectUri === "function"
        ? await options.redirectUri()
        : options.redirectUri;
      signal?.throwIfAborted();
      if (typeof redirectUri !== "string") {
        throw new TypeError("OAuth requires an explicit redirect URI");
      }
      let redirect: URL;
      try {
        redirect = new URL(redirectUri);
      } catch {
        throw new TypeError("OAuth redirect URI must be absolute");
      }
      if (
        redirect.username || redirect.password ||
        !["http:", "https:", "veryfront:"].includes(redirect.protocol)
      ) {
        throw new TypeError("Unsupported OAuth redirect URI");
      }
      const body = JSON.stringify({
        integration,
        project_reference: selectedProject.id,
        scope,
        redirect_uri: redirectUri,
      });
      if (new TextEncoder().encode(body).byteLength > MAX_INTEGRATION_CALL_REQUEST_BYTES) {
        throw new RangeError("Integration connect request exceeds the byte limit");
      }
      const result = await request("/oauth/connect/session", { method: "POST", body, signal });
      const expires = typeof result.expires_at === "string" ? Date.parse(result.expires_at) : NaN;
      let connectUrl: URL;
      try {
        connectUrl = new URL(
          typeof result.connect_url === "string" ? resolveUrl(result.connect_url) : "",
        );
      } catch {
        throw new IntegrationApiError("invalid_response", 200, false);
      }
      const expectedUrl = new URL(resolveUrl(`/oauth/connect/${integrationPath(integration)}`));
      if (
        typeof result.session_token !== "string" || !/^[a-f0-9]{64}$/i.test(result.session_token) ||
        connectUrl.pathname !== expectedUrl.pathname || connectUrl.username ||
        connectUrl.password || connectUrl.hash ||
        connectUrl.searchParams.getAll("session_token").length !== 1 ||
        connectUrl.searchParams.get("session_token") !== result.session_token ||
        !Number.isFinite(expires) || new Date(expires).toISOString() !== result.expires_at
      ) {
        throw new IntegrationApiError("invalid_response", 200, false);
      }
      const handoff: IntegrationOAuthHandoff = {
        status: "oauth_handoff",
        integration,
        project_id: selectedProject.id,
        scope,
        connect_url: connectUrl.toString(),
        expires_at: result.expires_at as string,
      };
      Object.defineProperty(handoff, "connect_url", { enumerable: false });
      return Object.freeze(handoff);
    },
    listTools(integration: string, options: { name?: string; order?: "asc" | "desc" } = {}) {
      return pages<IntegrationClientTool>(
        `/integrations/${integrationPath(integration)}/tools`,
        "tools",
        { order: options.order ?? "asc", ...(options.name ? { name: options.name } : {}) },
        (item) =>
          typeof item.name === "string" && item.name.startsWith(`${integration}__`) &&
          parseIntegrationToolIdentity(item.name) !== null &&
          typeof item.description === "string" && record(item.inputSchema),
      );
    },
    listConnections(integration: string, options: { abortSignal?: AbortSignal } = {}) {
      return pages<IntegrationClientConnection>(
        `/projects/${encodeURIComponent(selectedProject.id)}/integrations/${
          integrationPath(integration)
        }/connections`,
        "data",
        { sort_by: "created_at", sort_order: "asc" },
        (item) =>
          uuid(item.id) && uuid(item.connection_generation_id) &&
          item.integration === integration && (item.scope === "user" || item.scope === "project") &&
          typeof item.status === "string" &&
          ["connected", "expired", "disconnected"].includes(item.status),
        options.abortSignal,
      );
    },
    async status(
      integration: string,
      scope: "user" | "project",
      options: { abortSignal?: AbortSignal } = {},
    ) {
      if (scope !== "user" && scope !== "project") {
        throw new TypeError("OAuth status requires an explicit user or project scope");
      }
      const params = new URLSearchParams({ project_reference: selectedProject.id, scope });
      return requireShape<IntegrationConnectionStatus>(
        await request(`/oauth/status/${integrationPath(integration)}?${params}`, {
          signal: options.abortSignal,
        }),
        (item) =>
          typeof item.connected === "boolean" && item.integration === integration &&
          ["connection_id", "connection_generation_id", "connectionId", "connectionGenerationId"]
            .every((key) => item[key] === undefined || uuid(item[key])) &&
          (item.connection_id === undefined || item.connectionId === undefined ||
            item.connection_id === item.connectionId) &&
          (item.connection_generation_id === undefined ||
            item.connectionGenerationId === undefined ||
            item.connection_generation_id === item.connectionGenerationId),
      );
    },
    async call(
      toolName: string,
      args: Record<string, unknown>,
      options: IntegrationCallOptions = {},
    ) {
      const identity =
        typeof toolName === "string" && toolName.length <= MAX_REMOTE_INTEGRATION_TOOL_NAME_LENGTH
          ? parseIntegrationToolIdentity(toolName)
          : null;
      if (!identity) {
        throw new TypeError("Tool name must use canonical integration__tool_id format");
      }
      if (options.connectionId !== undefined && !uuid(options.connectionId)) {
        throw new TypeError("connectionId must be a UUID");
      }
      const signal = context.abortSignal && options.abortSignal
        ? AbortSignal.any([context.abortSignal, options.abortSignal])
        : context.abortSignal ?? options.abortSignal;
      signal?.throwIfAborted();
      const body = JSON.stringify({
        arguments: boundedObject(args),
        ...(options.connectionId !== undefined ? { connection_id: options.connectionId } : {}),
      });
      if (new TextEncoder().encode(body).byteLength > MAX_INTEGRATION_CALL_REQUEST_BYTES) {
        throw new RangeError("Integration call request exceeds the byte limit");
      }
      const result = parseToolResult(
        await request(
          `/integrations/${encodeURIComponent(identity.integration)}/tools/${
            encodeURIComponent(identity.toolId)
          }/call`,
          { method: "POST", body, signal, execution: true, requireProjectBinding: true },
        ),
      );
      if (result.isError === true) {
        const condition = readIntegrationFailureCondition(result._meta?.condition);
        return { status: "tool_error" as const, result, ...(condition ? { condition } : {}) };
      }
      return { status: "success" as const, result };
    },
  });
}
