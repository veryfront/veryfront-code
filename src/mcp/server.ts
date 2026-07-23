import { getMCPRegistry } from "./registry.ts";
import { executeTool } from "#veryfront/tool";
import type { Tool } from "#veryfront/tool";
import { zodToJsonSchema } from "#veryfront/tool/schema/index.ts";
import { resourceRegistry } from "#veryfront/resource";
import { promptRegistry } from "#veryfront/prompt";
import type { JSONRPCParams, MCPRequestContext, MCPServerConfig, ToolListEntry } from "./types.ts";
import { CONFIG_INVALID, createError, toError } from "#veryfront/errors";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { VERSION } from "#veryfront/utils/version.ts";
import { logger as baseLogger } from "#veryfront/utils";
import { createMCPHTTPHandler } from "./http-transport.ts";
import { SessionManager } from "./session.ts";
import { TaskStore } from "./task-store.ts";
import { sanitizeErrorText } from "#veryfront/errors/sanitization.ts";
import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";
import { getMCPServerConfigSchema } from "./schemas/mcp.schema.ts";

const logger = baseLogger.component("mcp-server");
const MAX_CONTEXT_HEADER_LENGTH = 255;
const PROJECT_ID_PATTERN = /^[a-zA-Z0-9._-]+$/;
const MAX_MCP_JSON_CONTENT_BYTES = 1024 * 1024;
const MAX_PENDING_REQUESTS = 1000;
const MAX_LIST_PAGE_SIZE = 100;
const MAX_CURSOR_LENGTH = 8192;
const MAX_TOOL_NAME_LENGTH = 4096;
const MAX_PROMPT_NAME_LENGTH = 4096;
const MAX_TASK_ID_LENGTH = 128;
const MAX_PROGRESS_TOKEN_LENGTH = 255;
const LOCAL_TASK_OWNER = "<local>";
const TRACEABLE_MCP_METHODS = new Set([
  "tools/list",
  "tools/call",
  "resources/list",
  "resources/read",
  "resources/templates/list",
  "prompts/list",
  "prompts/get",
  "initialize",
  "notifications/initialized",
  "notifications/cancelled",
  "ping",
  "logging/setLevel",
  "tasks/get",
  "tasks/result",
  "tasks/cancel",
  "tasks/list",
]);

class JsonRpcError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

function errorCode(error: unknown): number {
  return error instanceof JsonRpcError ? error.code : -32603;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return sanitizeErrorText(error.message);
  if (typeof error === "object" && error !== null && "message" in error) {
    return sanitizeErrorText(String((error as { message: unknown }).message));
  }
  return "Internal error";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function serializeJsonContent(result: unknown, label: string): string {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(result, null, 2);
  } catch {
    throw new TypeError(`The ${label} is not JSON-serializable`);
  }
  if (serialized === undefined) serialized = "null";
  if (new TextEncoder().encode(serialized).byteLength > MAX_MCP_JSON_CONTENT_BYTES) {
    throw new TypeError(
      `The ${label} exceeds the ${MAX_MCP_JSON_CONTENT_BYTES}-byte MCP output limit`,
    );
  }
  return serialized;
}

function cloneMCPMetadata(value: unknown, label: string): unknown {
  try {
    return structuredClone(value);
  } catch {
    throw new TypeError(`The ${label} must be cloneable`);
  }
}

function successfulToolResult(
  tool: Tool,
  result: unknown,
): Record<string, unknown> {
  const output = tool.outputSchema === undefined ? result : tool.outputSchema.parse(result);
  const serialized = serializeJsonContent(output, "tool result");
  const response: Record<string, unknown> = {
    content: [{ type: "text", text: serialized }],
    isError: false,
  };

  if (tool.outputSchemaJson !== undefined) {
    const structuredContent = JSON.parse(serialized) as unknown;
    if (!isRecord(structuredContent)) {
      throw new TypeError(
        "The tool result must be a JSON object when an output schema is declared",
      );
    }
    response.structuredContent = structuredContent;
  }
  return response;
}

function isBoundedIdentifier(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength &&
    !hasUnsafeControlCharacters(value);
}

function toolErrorResult(message: string): Record<string, unknown> {
  return {
    content: [{ type: "text", text: sanitizeErrorText(message) }],
    isError: true,
  };
}

function relatedTaskResult(
  result: Record<string, unknown>,
  taskId: string,
): Record<string, unknown> {
  const existingMeta = isRecord(result._meta) ? result._meta : {};
  return {
    ...result,
    _meta: {
      ...existingMeta,
      "io.modelcontextprotocol/related-task": { taskId },
    },
  };
}

function encodeCursor(kind: string, id: string): string {
  return `${kind}:${encodeURIComponent(id)}`;
}

function paginate<T>(
  items: T[],
  params: JSONRPCParams | undefined,
  kind: string,
  getId: (item: T) => string,
): { items: T[]; nextCursor?: string } {
  const { cursor } = toParamsRecord(params);
  if (
    cursor !== undefined &&
    (typeof cursor !== "string" || cursor.length === 0 ||
      cursor.length > MAX_CURSOR_LENGTH)
  ) {
    throw new JsonRpcError(-32602, `${kind} cursor is invalid`);
  }

  let start = 0;
  if (typeof cursor === "string") {
    const prefix = `${kind}:`;
    if (!cursor.startsWith(prefix)) {
      throw new JsonRpcError(-32602, `${kind} cursor is invalid or expired`);
    }
    let id: string;
    try {
      id = decodeURIComponent(cursor.slice(prefix.length));
    } catch {
      throw new JsonRpcError(-32602, `${kind} cursor is invalid or expired`);
    }
    const index = items.findIndex((item) => getId(item) === id);
    if (index < 0) {
      throw new JsonRpcError(-32602, `${kind} cursor is invalid or expired`);
    }
    start = index + 1;
  }

  const page = items.slice(start, start + MAX_LIST_PAGE_SIZE);
  const result: { items: T[]; nextCursor?: string } = { items: page };
  if (start + page.length < items.length) {
    result.nextCursor = encodeCursor(kind, getId(page.at(-1)!));
  }
  return result;
}

function toParamsRecord(params: JSONRPCParams | undefined): Record<string, unknown> {
  if (!params || Array.isArray(params)) return {};
  return params;
}

function readAllowedHeader(
  request: Request,
  headerName: string,
  pattern: RegExp,
): string | undefined {
  const value = request.headers.get(headerName);
  if (!value || value.length > MAX_CONTEXT_HEADER_LENGTH || !pattern.test(value)) {
    return undefined;
  }
  return value;
}

/** JSON-RPC request accepted by the in-process MCP dispatcher. */
export interface JSONRPCRequest {
  /** Protocol version. */
  jsonrpc: "2.0";
  /** Request identifier, omitted only for notifications. */
  id?: string | number;
  /** MCP method name. */
  method: string;
  /** Optional method parameters. */
  params?: JSONRPCParams;
}

/** JSON-RPC response returned by the in-process MCP dispatcher. */
export interface JSONRPCResponse {
  /** Protocol version. */
  jsonrpc: "2.0";
  /** Identifier copied from the corresponding request. */
  id?: string | number;
  /** Successful method result. */
  result?: unknown;
  /** Contained JSON-RPC failure. */
  error?: {
    /** JSON-RPC error code. */
    code: number;
    /** Sanitized failure message. */
    message: string;
    /** Optional structured failure detail. */
    data?: unknown;
  };
}

interface PendingTaskRun {
  promise: Promise<void>;
  abortController: AbortController;
}

interface PendingRequestRun {
  abortController: AbortController;
  sessionId?: string;
}

interface PendingRequestScope {
  signal?: AbortSignal;
  release: () => void;
}

function pendingRequestKey(requestId: string | number, sessionId?: string): string {
  return JSON.stringify([sessionId ?? null, typeof requestId, requestId]);
}

/**
 * Whether an Origin header points at the local loopback interface (any port).
 * Used as the default Origin allowlist when none is configured.
 */
function isLoopbackOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" || url.password !== "" || url.origin !== origin
  ) {
    return false;
  }
  const hostname = url.hostname;
  return hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]";
}

const MCP_TASKS_PROTOCOL_VERSION = "2025-11-25";
const MCP_SUPPORTED_VERSIONS = [MCP_TASKS_PROTOCOL_VERSION, "2024-11-05"];

/** Implements the Veryfront MCP protocol server. */
export class MCPServer {
  private static LOG_LEVELS = [
    "debug",
    "info",
    "notice",
    "warning",
    "error",
    "critical",
    "alert",
    "emergency",
  ] as const;
  private logLevel: typeof MCPServer.LOG_LEVELS[number] = "warning";
  private config: MCPServerConfig;
  private sessionManager: SessionManager;
  private taskStore: TaskStore;
  private pendingTasks = new Map<string, PendingTaskRun>();
  private pendingRequestAbortControllers = new Map<string, PendingRequestRun>();
  private taskOwners = new Map<string, string>();
  private clientCapabilities: Record<string, unknown> = {};
  private sessionCapabilities = new Map<string, Record<string, unknown>>();
  private sessionProtocolVersions = new Map<string, string>();

  /** Callback for server-initiated notifications. Set by transport layer. */
  onNotification?: (notification: { jsonrpc: "2.0"; method: string; params?: unknown }) => void;

  /** Create a protocol server with validated authentication and lifecycle state. */
  constructor(config: MCPServerConfig) {
    MCPServer.validateAuthConfig(config);
    try {
      this.config = getMCPServerConfigSchema().parse(config) as MCPServerConfig;
    } catch {
      throw CONFIG_INVALID.create({
        detail: "MCP server configuration is invalid. Check enabled, port, auth, and CORS fields.",
      });
    }
    this.taskStore = new TaskStore({
      onDelete: (taskId) => {
        this.pendingTasks.get(taskId)?.abortController.abort();
        this.taskOwners.delete(taskId);
      },
    });
    this.sessionManager = new SessionManager({
      onRemove: (sessionId) => this.cleanupSession(sessionId),
    });

    if (this.config.auth.type === "none") {
      logger.warn(
        "MCP server started with auth.type='none' (allowUnauthenticated). All requests will be accepted",
      );
    }
  }

  /**
   * Fail-closed validation of the auth configuration (VULN-SRV-5).
   *
   * Historically, an unset `auth` field or `{ type: "none" }` silently
   * accepted every request with only a warning log. That meant an operator who
   * forgot to configure auth shipped an unauthenticated JSON-RPC surface.
   *
   * The new contract: `auth` is required, and the only way to accept
   * unauthenticated traffic is to explicitly set
   * `{ type: "none", allowUnauthenticated: true }`. Any other shape is
   * rejected at construction time.
   */
  private static validateAuthConfig(config: MCPServerConfig): void {
    if (!isRecord(config)) {
      throw CONFIG_INVALID.create({
        detail: "MCP server configuration must be an object.",
      });
    }
    const auth = (config as { auth?: unknown }).auth;

    if (auth === undefined || auth === null) {
      throw CONFIG_INVALID.create({
        detail: "MCP auth must be configured. For local dev, pass " +
          "{ auth: { type: 'none', allowUnauthenticated: true } } explicitly.",
      });
    }

    if (typeof auth !== "object") {
      throw CONFIG_INVALID.create({
        detail: "MCP auth must be an object. For local dev, pass " +
          "{ auth: { type: 'none', allowUnauthenticated: true } } explicitly.",
      });
    }

    const type = (auth as { type?: unknown }).type;

    if (type === "none") {
      const allow = (auth as { allowUnauthenticated?: unknown }).allowUnauthenticated;
      if (allow !== true) {
        throw CONFIG_INVALID.create({
          detail: "MCP auth type 'none' requires allowUnauthenticated: true to acknowledge " +
            "the server will accept all requests.",
        });
      }
      return;
    }

    if (type === "bearer") {
      if (typeof (auth as { validate?: unknown }).validate !== "function") {
        throw CONFIG_INVALID.create({
          detail: "MCP bearer auth requires a token validation function.",
        });
      }
      return;
    }

    throw CONFIG_INVALID.create({
      detail: `MCP auth type '${String(type)}' is not supported. Use 'bearer' ` +
        "or { type: 'none', allowUnauthenticated: true } for explicit opt-in to " +
        "unauthenticated traffic.",
    });
  }

  /** Notify the connected client that the visible tool list changed. */
  notifyToolsChanged(): void {
    this.onNotification?.({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
  }

  /** Notify the connected client that the visible resource list changed. */
  notifyResourcesChanged(): void {
    this.onNotification?.({ jsonrpc: "2.0", method: "notifications/resources/list_changed" });
  }

  /** Notify the connected client that the visible prompt list changed. */
  notifyPromptsChanged(): void {
    this.onNotification?.({ jsonrpc: "2.0", method: "notifications/prompts/list_changed" });
  }

  /** Report if the active client session advertises one elicitation mode. */
  clientSupportsElicitation(mode: "form" | "url", sessionId?: string): boolean {
    const capabilities = sessionId
      ? this.sessionCapabilities.get(sessionId) ?? {}
      : this.clientCapabilities;
    const raw = capabilities.elicitation;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const elicitation = raw as Record<string, unknown>;
    // Per MCP spec: empty elicitation object implies basic form support (backwards compat)
    if (mode === "form" && Object.keys(elicitation).length === 0) return true;
    return Object.hasOwn(elicitation, mode) && isRecord(elicitation[mode]);
  }

  /** Dispatch one validated JSON-RPC request and contain protocol failures. */
  handleRequest(
    request: JSONRPCRequest,
    context?: MCPRequestContext,
    sessionId?: string,
  ): Promise<JSONRPCResponse> {
    return withSpan(
      "mcp.handleRequest",
      async () => {
        try {
          const result = await this.dispatch(
            request.method,
            request.params,
            context,
            request.id,
            sessionId,
          );
          return { jsonrpc: "2.0", id: request.id, result };
        } catch (error) {
          return {
            jsonrpc: "2.0",
            id: request.id,
            error: { code: errorCode(error), message: errorMessage(error) },
          };
        }
      },
      {
        "mcp.method": TRACEABLE_MCP_METHODS.has(request.method) ? request.method : "unknown",
      },
    );
  }

  /** Report whether the request's negotiated protocol includes MCP tasks. */
  private supportsTasks(sessionId?: string): boolean {
    if (sessionId === undefined) return true;
    const negotiatedVersion = this.sessionProtocolVersions.get(sessionId);
    return negotiatedVersion === undefined || negotiatedVersion === MCP_TASKS_PROTOCOL_VERSION;
  }

  /** Reject task methods that were not part of the negotiated protocol. */
  private requireTaskProtocol(sessionId?: string): void {
    if (!this.supportsTasks(sessionId)) {
      throw new JsonRpcError(-32601, "Method not found");
    }
  }

  /** Route one supported MCP method to its bounded implementation. */
  private dispatch(
    method: string,
    params: JSONRPCParams | undefined,
    context?: MCPRequestContext,
    requestId?: string | number,
    sessionId?: string,
  ): Promise<unknown> {
    if (Array.isArray(params)) {
      throw new JsonRpcError(-32602, "MCP method parameters must be an object");
    }
    switch (method) {
      case "tools/list":
        return this.listTools(params, sessionId);
      case "tools/call":
        return this.callTool(params, context, requestId, sessionId);
      case "resources/list":
        return this.listResources(params);
      case "resources/read":
        return this.readResource(params, context, requestId, sessionId);
      case "resources/templates/list":
        return this.listResourceTemplates(params);
      case "prompts/list":
        return this.listPrompts(params);
      case "prompts/get":
        return this.getPrompt(params, context, requestId, sessionId);
      case "initialize":
        return this.initialize(params);
      case "notifications/initialized":
        return Promise.resolve({});
      case "notifications/cancelled":
        return this.cancelRequest(params, sessionId);
      case "ping":
        return Promise.resolve({});
      case "logging/setLevel":
        return this.setLogLevel(params);
      case "tasks/get":
        this.requireTaskProtocol(sessionId);
        return this.getTask(params, sessionId);
      case "tasks/result":
        this.requireTaskProtocol(sessionId);
        return this.getTaskResult(params, context, requestId, sessionId);
      case "tasks/cancel":
        this.requireTaskProtocol(sessionId);
        return this.cancelTask(params, sessionId);
      case "tasks/list":
        this.requireTaskProtocol(sessionId);
        return this.listTasks(params, sessionId);
      default:
        throw new JsonRpcError(-32601, "Method not found");
    }
  }

  /** Negotiate a protocol version and advertise server capabilities. */
  private initialize(params: JSONRPCParams | undefined): Promise<Record<string, unknown>> {
    const p = toParamsRecord(params);
    const requested = typeof p.protocolVersion === "string" ? p.protocolVersion : undefined;
    const negotiated = requested && MCP_SUPPORTED_VERSIONS.includes(requested)
      ? requested
      : MCP_SUPPORTED_VERSIONS[0];

    const clientCaps = isRecord(p.capabilities) ? p.capabilities : {};
    this.clientCapabilities = clientCaps;

    const capabilities: Record<string, unknown> = {
      tools: { listChanged: true },
      resources: { listChanged: true },
      prompts: { listChanged: true },
      logging: {},
    };
    if (negotiated === MCP_TASKS_PROTOCOL_VERSION) {
      capabilities.tasks = { list: {}, cancel: {}, requests: { tools: { call: {} } } };
    }

    return Promise.resolve({
      protocolVersion: negotiated,
      serverInfo: {
        name: "veryfront-mcp",
        title: "Veryfront MCP Server",
        version: VERSION,
        description:
          "Veryfront development server tools for real-time errors, route preview, HMR control, and scaffolding",
      },
      capabilities,
      instructions:
        "Veryfront MCP server provides development tools. Use vf_get_errors to check for code errors, vf_get_logs for server logs, vf_scaffold for code generation, and vf_get_project_context for project structure.",
    });
  }

  /** List one bounded page of tools visible to the current MCP client. */
  private async listTools(
    params?: JSONRPCParams,
    sessionId?: string,
  ): Promise<{ tools: ToolListEntry[]; nextCursor?: string }> {
    const registry = getMCPRegistry();
    const tools: ToolListEntry[] = [];

    for (const [id, tool] of registry.tools.entries()) {
      if (tool.mcp?.enabled === false) continue;
      if (tool.mcp?.requiresAuth === true && this.config.auth.type === "none") continue;
      // Agent-owned tools are never listed to MCP clients: external callers
      // have no agent identity, so owned capabilities are invisible here
      // (and rejected at execution time by the registry executor).
      if (tool.ownerAgentId !== undefined) continue;

      const entry: ToolListEntry = {
        name: id,
        description: tool.description,
        inputSchema: cloneMCPMetadata(
          tool.inputSchemaJson ?? zodToJsonSchema(tool.inputSchema),
          "tool input schema",
        ),
      };
      if (this.supportsTasks(sessionId)) {
        entry.execution = { taskSupport: "optional" };
      }
      if (tool.outputSchemaJson !== undefined) {
        entry.outputSchema = cloneMCPMetadata(
          tool.outputSchemaJson,
          "tool output schema",
        );
      }
      if (tool.mcp?.title) entry.title = tool.mcp.title;
      if (tool.mcp?.annotations) {
        entry.annotations = cloneMCPMetadata(
          tool.mcp.annotations,
          "tool annotations",
        ) as ToolListEntry["annotations"];
      }
      tools.push(entry);
    }

    const page = paginate(tools, params, "tools", (tool) => tool.name);
    return { tools: page.items, nextCursor: page.nextCursor };
  }

  /** Validate and execute one foreground or task-backed tool call. */
  private callTool(
    params: JSONRPCParams | undefined,
    context?: MCPRequestContext,
    requestId?: string | number,
    sessionId?: string,
  ): Promise<Record<string, unknown>> {
    const p = toParamsRecord(params);
    const { name, arguments: args } = p;
    const meta = isRecord(p._meta) ? p._meta : {};
    const rawToken = meta.progressToken;
    const progressToken = typeof rawToken === "string" &&
        rawToken.length <= MAX_PROGRESS_TOKEN_LENGTH
      ? rawToken
      : typeof rawToken === "number" && Number.isSafeInteger(rawToken)
      ? rawToken
      : undefined;

    if (!isBoundedIdentifier(name, MAX_TOOL_NAME_LENGTH)) {
      throw new JsonRpcError(-32602, "Tool name is required");
    }

    const toolName = name;

    const registry = getMCPRegistry();
    const tool = registry.tools.get(toolName);
    if (!tool) {
      throw new JsonRpcError(-32602, `Unknown tool: ${toolName}`);
    }

    // Tools disabled for MCP are hidden from tools/list; reject calls to them
    // too so a client can't invoke a capability it was never offered.
    if (tool.mcp?.enabled === false) {
      throw new JsonRpcError(-32601, `Unknown tool: ${toolName}`);
    }
    if (tool.mcp?.requiresAuth === true && this.config.auth.type === "none") {
      throw new JsonRpcError(-32601, `Unknown tool: ${toolName}`);
    }

    if (tool.inputSchema && typeof tool.inputSchema.parse === "function") {
      try {
        tool.inputSchema.parse(args ?? {});
      } catch (error) {
        const message = error instanceof Error ? error.message : "Invalid tool arguments";
        return Promise.resolve(
          toolErrorResult(`Invalid arguments for tool ${toolName}: ${message}`),
        );
      }
    }

    const toolContext: MCPRequestContext | undefined = progressToken !== undefined
      ? { ...context, progressToken }
      : context;

    // Async task mode: if the caller provides a `task` field, create a task
    // and run the tool in the background, returning the task immediately.
    const taskParam = p.task;
    if (taskParam !== undefined) {
      if (!this.supportsTasks(sessionId)) {
        throw new JsonRpcError(
          -32602,
          `Task-backed tool calls require MCP protocol version ${MCP_TASKS_PROTOCOL_VERSION}`,
        );
      }
      if (!isRecord(taskParam)) {
        throw new JsonRpcError(-32602, "The task parameter must be an object");
      }
      const MIN_TTL = 1000;
      const MAX_TTL = 3_600_000;
      if (
        taskParam.ttl !== undefined &&
        (!Number.isSafeInteger(taskParam.ttl) || Number(taskParam.ttl) <= 0)
      ) {
        throw new JsonRpcError(-32602, "The task TTL must be a positive integer");
      }
      const rawTtl = typeof taskParam.ttl === "number" ? taskParam.ttl : 60000;
      const ttl = Math.max(MIN_TTL, Math.min(MAX_TTL, rawTtl));
      const task = this.taskStore.create(ttl);
      this.taskOwners.set(task.taskId, sessionId ?? LOCAL_TASK_OWNER);
      const abortController = new AbortController();
      const outerAbortSignal = toolContext?.abortSignal;
      const abortFromOuterSignal = () => abortController.abort();
      if (outerAbortSignal?.aborted) {
        abortController.abort();
      } else {
        outerAbortSignal?.addEventListener("abort", abortFromOuterSignal, { once: true });
      }
      const taskToolContext: MCPRequestContext = {
        ...toolContext,
        abortSignal: abortController.signal,
      };

      // Run tool in background, update task on completion
      const pending = withSpan(
        "mcp.callTool.async",
        async () => {
          try {
            const result = await executeTool(toolName, args, taskToolContext);
            this.taskStore.complete(task.taskId, successfulToolResult(tool, result));
          } catch (error) {
            const currentTask = this.taskStore.get(task.taskId);
            if (!currentTask || currentTask.status === "cancelled") {
              return;
            }
            const message = sanitizeErrorText(
              error instanceof Error ? error.message : "Tool execution failed",
            );
            logger.warn("Async tool execution failed", {
              tool: toolName,
              errorName: error instanceof Error ? error.name : "UnknownError",
            });
            this.taskStore.fail(
              task.taskId,
              message,
              toolErrorResult(message),
            );
          }
        },
        { "mcp.tool.name": toolName },
      ).finally(() => {
        outerAbortSignal?.removeEventListener("abort", abortFromOuterSignal);
        this.pendingTasks.delete(task.taskId);
      });
      this.pendingTasks.set(task.taskId, { promise: pending, abortController });

      return Promise.resolve(relatedTaskResult({ task }, task.taskId));
    }

    return withSpan(
      "mcp.callTool",
      async () => {
        const outerAbortSignal = toolContext?.abortSignal;
        const pendingRequest = this.trackPendingRequest(
          requestId,
          sessionId,
          outerAbortSignal,
        );
        const foregroundToolContext: MCPRequestContext | undefined = pendingRequest.signal
          ? { ...toolContext, abortSignal: pendingRequest.signal }
          : toolContext;

        try {
          const result = await executeTool(toolName, args, foregroundToolContext);
          return successfulToolResult(tool, result);
        } catch (error) {
          if (error instanceof JsonRpcError) throw error;
          const message = error instanceof Error ? error.message : "Tool execution failed";
          return toolErrorResult(message);
        } finally {
          pendingRequest.release();
        }
      },
      { "mcp.tool.name": toolName },
    );
  }

  /** List one bounded page of parameterized resource templates. */
  private listResourceTemplates(
    params?: JSONRPCParams,
  ): Promise<{
    resourceTemplates: Array<Record<string, unknown>>;
    nextCursor?: string;
  }> {
    const registry = getMCPRegistry();
    const templates: Array<Record<string, unknown>> = [];

    for (const [id, resource] of registry.resources.entries()) {
      if (resource.mcp?.enabled === false) continue;
      const uriTemplate = resourceRegistry.toUriTemplate(resource.pattern);
      if (uriTemplate !== undefined) {
        const entry: Record<string, unknown> = {
          uriTemplate,
          name: id,
          description: resource.description,
          mimeType: "application/json",
        };
        if (resource.title) entry.title = resource.title;
        templates.push(entry);
      }
    }

    const page = paginate(
      templates,
      params,
      "resource-templates",
      (template) => String(template.name),
    );
    return Promise.resolve({
      resourceTemplates: page.items,
      nextCursor: page.nextCursor,
    });
  }

  /** List one bounded page of concrete MCP resources. */
  private listResources(
    params?: JSONRPCParams,
  ): Promise<{ resources: Array<Record<string, unknown>>; nextCursor?: string }> {
    const registry = getMCPRegistry();
    const resources: Array<Record<string, unknown>> = [];

    for (const [id, resource] of registry.resources.entries()) {
      if (
        resource.mcp?.enabled === false ||
        resourceRegistry.toUriTemplate(resource.pattern) !== undefined
      ) {
        continue;
      }
      const entry: Record<string, unknown> = {
        uri: resource.pattern,
        name: id,
        description: resource.description,
        mimeType: "application/json",
      };
      if (resource.title) entry.title = resource.title;
      resources.push(entry);
    }

    const page = paginate(
      resources,
      params,
      "resources",
      (resource) => String(resource.name),
    );
    return Promise.resolve({
      resources: page.items,
      nextCursor: page.nextCursor,
    });
  }

  /** Resolve, load, and serialize one resource under request cancellation. */
  private readResource(
    params: JSONRPCParams | undefined,
    context?: MCPRequestContext,
    requestId?: string | number,
    sessionId?: string,
  ): Promise<Record<string, unknown>> {
    const { uri } = toParamsRecord(params);

    if (typeof uri !== "string") {
      throw toError(
        createError({
          type: "agent",
          message: "Resource URI is required",
        }),
      );
    }

    const resourceUri = uri;

    return withSpan(
      "mcp.readResource",
      async () => {
        const outerAbortSignal = context?.abortSignal;
        const pendingRequest = this.trackPendingRequest(
          requestId,
          sessionId,
          outerAbortSignal,
        );

        try {
          const resource = resourceRegistry.findByPattern(resourceUri);

          if (!resource) {
            throw toError(
              createError({
                type: "agent",
                message: `Resource not found: ${resourceUri}`,
              }),
            );
          }
          if (resource.mcp?.enabled === false) {
            throw new JsonRpcError(-32002, "Resource not found");
          }

          const resourceParams = resourceRegistry.extractParams(resourceUri, resource.pattern);
          const data = await resource.load(
            resourceParams,
            pendingRequest.signal === undefined ? undefined : { signal: pendingRequest.signal },
          );

          return {
            contents: [
              {
                uri: resourceUri,
                mimeType: "application/json",
                text: serializeJsonContent(data, "resource result"),
              },
            ],
          };
        } finally {
          pendingRequest.release();
        }
      },
      { "mcp.resource.operation": "read" },
    );
  }

  /** List one bounded page of registered prompts. */
  private listPrompts(
    params?: JSONRPCParams,
  ): Promise<{ prompts: Array<Record<string, unknown>>; nextCursor?: string }> {
    const registry = getMCPRegistry();
    const prompts: Array<Record<string, unknown>> = [];

    for (const [id, promptInstance] of registry.prompts.entries()) {
      prompts.push({
        name: id,
        description: promptInstance.description,
        ...(promptInstance.arguments === undefined
          ? {}
          : { arguments: promptInstance.arguments.map((argument) => ({ ...argument })) }),
      });
    }

    const page = paginate(
      prompts,
      params,
      "prompts",
      (prompt) => String(prompt.name),
    );
    return Promise.resolve({
      prompts: page.items,
      nextCursor: page.nextCursor,
    });
  }

  /** Resolve and render one prompt under request cancellation. */
  private getPrompt(
    params: JSONRPCParams | undefined,
    context?: MCPRequestContext,
    requestId?: string | number,
    sessionId?: string,
  ): Promise<Record<string, unknown>> {
    const { name, arguments: args } = toParamsRecord(params);

    if (!isBoundedIdentifier(name, MAX_PROMPT_NAME_LENGTH)) {
      throw toError(
        createError({
          type: "agent",
          message: "Prompt name is required",
        }),
      );
    }
    if (args !== undefined && !isRecord(args)) {
      throw new JsonRpcError(-32602, "Prompt arguments must be an object");
    }

    const promptName = name;

    return withSpan(
      "mcp.getPrompt",
      async () => {
        const pendingRequest = this.trackPendingRequest(
          requestId,
          sessionId,
          context?.abortSignal,
        );
        try {
          const promptDefinition = promptRegistry.get(promptName);
          if (!promptDefinition) {
            throw new JsonRpcError(-32602, `Unknown prompt: ${promptName}`);
          }
          const content = await promptDefinition.getContent(
            args,
            pendingRequest.signal ? { signal: pendingRequest.signal } : undefined,
          );

          return {
            description: promptDefinition.description,
            messages: [
              {
                role: "user",
                content: {
                  type: "text",
                  text: content,
                },
              },
            ],
          };
        } finally {
          pendingRequest.release();
        }
      },
      { "mcp.prompt.name": promptName },
    );
  }

  /**
   * Emit a `notifications/message` log entry to the connected MCP client,
   * but only if `level` meets the minimum threshold set via `logging/setLevel`.
   * This is what makes `this.logLevel` functional rather than a no-op field.
   */
  private emitLogNotification(
    level: typeof MCPServer.LOG_LEVELS[number],
    message: string,
    data?: Record<string, unknown>,
  ): void {
    const emitIdx = MCPServer.LOG_LEVELS.indexOf(level);
    const minIdx = MCPServer.LOG_LEVELS.indexOf(this.logLevel);
    if (emitIdx < minIdx) return;
    this.onNotification?.({
      jsonrpc: "2.0",
      method: "notifications/message",
      params: { level, logger: "veryfront-mcp", data: { message, ...data } },
    });
  }

  /** Apply a validated client-requested MCP log threshold. */
  private setLogLevel(
    params: JSONRPCParams | undefined,
  ): Promise<Record<string, unknown>> {
    const p = toParamsRecord(params);
    const level = p.level as string;
    if (
      !MCPServer.LOG_LEVELS.includes(
        level as typeof MCPServer.LOG_LEVELS[number],
      )
    ) {
      return Promise.reject(
        new JsonRpcError(
          -32602,
          `Invalid log level: ${level}. Valid levels: ${MCPServer.LOG_LEVELS.join(", ")}`,
        ),
      );
    }
    this.logLevel = level as typeof MCPServer.LOG_LEVELS[number];
    return Promise.resolve({});
  }

  /** Register request-scoped cancellation and return an idempotent release hook. */
  private trackPendingRequest(
    requestId: string | number | undefined,
    sessionId: string | undefined,
    outerSignal: AbortSignal | undefined,
  ): PendingRequestScope {
    if (requestId === undefined) {
      return { signal: outerSignal, release: () => undefined };
    }
    if (this.pendingRequestAbortControllers.size >= MAX_PENDING_REQUESTS) {
      throw new JsonRpcError(-32603, "Too many requests are currently in progress");
    }

    const requestKey = pendingRequestKey(requestId, sessionId);
    if (this.pendingRequestAbortControllers.has(requestKey)) {
      throw new JsonRpcError(-32600, "A request with this ID is already in progress");
    }

    const abortController = new AbortController();
    const abortFromOuterSignal = () => abortController.abort(outerSignal?.reason);
    if (outerSignal?.aborted) {
      abortController.abort(outerSignal.reason);
    } else {
      outerSignal?.addEventListener("abort", abortFromOuterSignal, { once: true });
    }
    this.pendingRequestAbortControllers.set(requestKey, {
      abortController,
      sessionId,
    });

    let released = false;
    return {
      signal: abortController.signal,
      release: () => {
        if (released) return;
        released = true;
        outerSignal?.removeEventListener("abort", abortFromOuterSignal);
        if (
          this.pendingRequestAbortControllers.get(requestKey)?.abortController ===
            abortController
        ) {
          this.pendingRequestAbortControllers.delete(requestKey);
        }
      },
    };
  }

  /** Cancel one in-flight request owned by the current session. */
  private cancelRequest(
    params: JSONRPCParams | undefined,
    sessionId?: string,
  ): Promise<Record<string, unknown>> {
    const { requestId } = toParamsRecord(params);
    if (typeof requestId !== "string" && typeof requestId !== "number") {
      return Promise.resolve({});
    }
    if (typeof requestId === "number" && !Number.isSafeInteger(requestId)) {
      return Promise.resolve({});
    }

    this.pendingRequestAbortControllers.get(pendingRequestKey(requestId, sessionId))
      ?.abortController.abort();
    return Promise.resolve({});
  }

  /** Read one task owned by the current session. */
  private getTask(
    params: JSONRPCParams | undefined,
    sessionId?: string,
  ): Promise<Record<string, unknown>> {
    const { taskId } = toParamsRecord(params);
    if (!isBoundedIdentifier(taskId, MAX_TASK_ID_LENGTH)) {
      throw new JsonRpcError(-32602, "taskId is required");
    }
    const task = this.taskStore.get(taskId);
    if (!task || !this.ownsTask(taskId, sessionId)) {
      throw new JsonRpcError(-32602, `Task not found: ${taskId}`);
    }
    return Promise.resolve({ ...task });
  }

  /** Wait for and return one session-owned task result. */
  private async getTaskResult(
    params: JSONRPCParams | undefined,
    context?: MCPRequestContext,
    requestId?: string | number,
    sessionId?: string,
  ): Promise<Record<string, unknown>> {
    const { taskId } = toParamsRecord(params);
    if (!isBoundedIdentifier(taskId, MAX_TASK_ID_LENGTH)) {
      throw new JsonRpcError(-32602, "taskId is required");
    }
    const task = this.taskStore.get(taskId);
    if (!task || !this.ownsTask(taskId, sessionId)) {
      throw new JsonRpcError(-32602, `Task not found: ${taskId}`);
    }

    const pendingRequest = this.trackPendingRequest(
      requestId,
      sessionId,
      context?.abortSignal,
    );

    try {
      const result = await this.taskStore.waitForResult(
        taskId,
        pendingRequest.signal,
      );
      if (!isRecord(result)) {
        throw new JsonRpcError(-32602, `Task not found: ${taskId}`);
      }
      return relatedTaskResult(result, taskId);
    } finally {
      pendingRequest.release();
    }
  }

  /** Cancel one active task owned by the current session. */
  private cancelTask(
    params: JSONRPCParams | undefined,
    sessionId?: string,
  ): Promise<Record<string, unknown>> {
    const { taskId } = toParamsRecord(params);
    if (!isBoundedIdentifier(taskId, MAX_TASK_ID_LENGTH)) {
      throw new JsonRpcError(-32602, "taskId is required");
    }
    const task = this.taskStore.get(taskId);
    if (!task || !this.ownsTask(taskId, sessionId)) {
      throw new JsonRpcError(-32602, `Task not found: ${taskId}`);
    }
    if (
      !this.taskStore.cancel(
        taskId,
        toolErrorResult("The task was cancelled by request."),
      )
    ) {
      throw new JsonRpcError(-32602, `Cannot cancel task: ${taskId}`);
    }
    this.pendingTasks.get(taskId)?.abortController.abort();
    return Promise.resolve({ ...this.taskStore.get(taskId)! });
  }

  /** List one bounded page of tasks owned by the current session. */
  private listTasks(
    params: JSONRPCParams | undefined,
    sessionId?: string,
  ): Promise<Record<string, unknown>> {
    const owner = sessionId ?? LOCAL_TASK_OWNER;
    const ownedTasks = this.taskStore.list().filter((task) =>
      this.taskOwners.get(task.taskId) === owner
    );
    const page = paginate(
      ownedTasks,
      params,
      "tasks",
      (task) => task.taskId,
    );
    return Promise.resolve({
      tasks: page.items,
      nextCursor: page.nextCursor,
    });
  }

  /** Wait for all background task executions to settle. Useful in tests. */
  async waitForPendingTasks(): Promise<void> {
    while (this.pendingTasks.size > 0) {
      await Promise.all(Array.from(this.pendingTasks.values(), (run) => run.promise));
    }
  }

  /** Abort active work and release all in-memory MCP state. */
  async close(): Promise<void> {
    for (const run of this.pendingTasks.values()) run.abortController.abort();
    for (const run of this.pendingRequestAbortControllers.values()) {
      run.abortController.abort();
    }
    this.sessionManager.clear();
    this.taskStore.clear();
    this.clientCapabilities = {};
    await this.waitForPendingTasks();
    this.pendingRequestAbortControllers.clear();
  }

  /** Report if a task belongs to the supplied or local session owner. */
  private ownsTask(taskId: string, sessionId?: string): boolean {
    return this.taskOwners.get(taskId) === (sessionId ?? LOCAL_TASK_OWNER);
  }

  /** Release capabilities, tasks, and pending requests owned by a session. */
  private cleanupSession(sessionId: string): void {
    this.sessionCapabilities.delete(sessionId);
    this.sessionProtocolVersions.delete(sessionId);
    for (const [taskId, owner] of this.taskOwners) {
      if (owner === sessionId) this.taskStore.delete(taskId);
    }
    for (const [key, run] of this.pendingRequestAbortControllers) {
      if (run.sessionId !== sessionId) continue;
      run.abortController.abort();
      this.pendingRequestAbortControllers.delete(key);
    }
  }

  /** Create the Streamable HTTP request handler for this server instance. */
  createHTTPHandler(): (request: Request) => Promise<Response> {
    return createMCPHTTPHandler({
      authEnabled: this.config.auth.type !== "none",
      getCORSHeaders: (requestOrigin) => this.getCORSHeaders(requestOrigin),
      validateAuth: (request) => this.validateAuth(request),
      handleRequest: (request, context, sessionId) =>
        this.handleRequest(request, context, sessionId),
      extractRequestContext: (request) => this.extractRequestContext(request),
      isOriginAllowed: (requestOrigin) => this.isOriginAllowed(requestOrigin),
      sessionCapabilities: this.sessionCapabilities,
      sessionProtocolVersions: this.sessionProtocolVersions,
      sessionManager: this.sessionManager,
    });
  }

  /** Extract validated request metadata allowed in tool execution context. */
  private extractRequestContext(request: Request): MCPRequestContext | undefined {
    const context: MCPRequestContext = {};

    const projectId = readAllowedHeader(request, "x-project-id", PROJECT_ID_PATTERN);
    if (projectId) {
      context.projectId = projectId;
    }

    return Object.keys(context).length > 0 ? context : undefined;
  }

  /**
   * Origin allowlist for the HTTP transport, enforced independently of the CORS
   * response configuration to defend against DNS-rebinding attacks. Non-browser
   * clients (no Origin header) are permitted. When explicit origins are
   * configured they are the allowlist; otherwise only loopback origins are
   * accepted so a default `auth: "none"` local server is not reachable from an
   * attacker-controlled page.
   */
  private isOriginAllowed(requestOrigin?: string | null): boolean {
    if (!requestOrigin) return true;

    const configuredOrigins = this.config.cors?.origins;
    if (configuredOrigins && configuredOrigins.length > 0) {
      return configuredOrigins.includes(requestOrigin);
    }

    return isLoopbackOrigin(requestOrigin);
  }

  /** Validate one HTTP request against the configured authentication policy. */
  private async validateAuth(request: Request): Promise<boolean> {
    const auth = this.config.auth;
    if (auth.type === "none") return true;

    const authHeader = request.headers.get("Authorization");
    if (!authHeader) return false;

    // Parse strictly: accept only "Bearer <token>" (scheme case-insensitive) and
    // reject other/no-scheme headers rather than passing a malformed value on.
    if (authHeader.length > 8192) return false;
    const bearerMatch = /^Bearer ([A-Za-z0-9._~+\/-]+=*)$/i.exec(authHeader);
    if (!bearerMatch) return false;
    const token = (bearerMatch[1] ?? "").trim();
    if (!token) return false;

    // z.function() in v4 does not carry argument or return types. Cast to the
    // signature enforced by constructor validation.
    const validate = auth.validate as (token: string) => Promise<boolean>;
    return await validate(token);
  }

  /** Build response CORS headers for an explicitly allowed request origin. */
  private getCORSHeaders(requestOrigin?: string | null): Record<string, string> {
    if (!this.config.cors?.enabled) return {};

    const origins = this.config.cors.origins;
    if (!origins || origins.length === 0) return {};

    // Match request origin against the configured origins list
    const matchedOrigin = requestOrigin && origins.includes(requestOrigin)
      ? requestOrigin
      : undefined;

    if (!matchedOrigin) return {};

    return {
      "Access-Control-Allow-Origin": matchedOrigin,
      "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, MCP-Session-Id, MCP-Protocol-Version, X-Project-Id",
      "Vary": "Origin",
    };
  }
}

/** Creates a Veryfront MCP protocol server. */
export function createMCPServer(config: MCPServerConfig): MCPServer {
  return new MCPServer(config);
}
