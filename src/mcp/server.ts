import { getMCPRegistry } from "./registry.ts";
import { executeTool } from "#veryfront/tool";
import type { ToolExecutionContext } from "#veryfront/tool";
import { zodToJsonSchema } from "#veryfront/tool/schema/index.ts";
import { resourceRegistry } from "#veryfront/resource";
import { promptRegistry } from "#veryfront/prompt";
import type { Prompt } from "#veryfront/prompt";
import type { MCPServerConfig, ToolListEntry } from "./types.ts";
import { CONFIG_INVALID, SERVICE_OVERLOADED, VeryfrontError } from "#veryfront/errors";
import { snapshotThrowableDiagnostic } from "#veryfront/errors/safe-diagnostics.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { VERSION } from "#veryfront/utils/version.ts";
import { computeHash, logger as baseLogger } from "#veryfront/utils";
import { base64urlDecodeBytes, base64urlEncode } from "#veryfront/utils/base64url.ts";
import { createMCPHTTPHandler } from "./http-transport.ts";
import { SessionManager } from "./session.ts";
import { TaskStore } from "./task-store.ts";
import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import {
  ResourceParamsValidationError,
  ResourceUriSyntaxError,
  ResourceUriValidationError,
} from "#veryfront/resource/errors.ts";
import {
  getResourceMCPMimeType,
  ResourceContentValidationError,
  toMCPResourceContents,
} from "#veryfront/resource/mcp-content.ts";
import {
  isSupportedMCPProtocolVersion,
  MCP_LATEST_PROTOCOL_VERSION,
  type MCPSupportedProtocolVersion,
} from "./protocol.ts";

const logger = baseLogger.component("mcp-server");
const MAX_MCP_TEXT_CONTENT_BYTES = 4 * 1024 * 1024;
const MCP_LIST_PAGE_SIZE = 50;
const MAX_MCP_LIST_CURSOR_LENGTH = 8_192;
const mcpTextEncoder = new TextEncoder();
const mcpCursorDecoder = new TextDecoder("utf-8", { fatal: true });

type JSONRPCParams = Record<string, unknown> | unknown[];
type MCPListKind = "tools" | "resources" | "resourceTemplates" | "prompts";

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
  return error instanceof JsonRpcError ? error.message : "Internal error";
}

function toParamsRecord(params: JSONRPCParams | undefined): Record<string, unknown> {
  if (!params || Array.isArray(params)) return {};
  return params;
}

function snapshotObject(
  value: unknown,
  errorMessage: string,
  errorCode = -32603,
): Record<string, unknown> {
  const snapshot = snapshotBoundedJsonValue(value);
  if (
    !snapshot.success ||
    snapshot.value === null ||
    typeof snapshot.value !== "object" ||
    Array.isArray(snapshot.value)
  ) {
    throw new JsonRpcError(errorCode, errorMessage);
  }
  return snapshot.value;
}

function encodeListCursor(
  namespace: string,
  kind: MCPListKind,
  sessionId: string | undefined,
  afterId: string,
): string {
  const cursor = base64urlEncode(
    JSON.stringify([1, namespace, kind, sessionId ?? null, afterId]),
  );
  if (cursor.length > MAX_MCP_LIST_CURSOR_LENGTH) {
    throw new JsonRpcError(-32603, "MCP list cursor exceeds the transport limit");
  }
  return cursor;
}

function decodeListCursor(
  cursor: unknown,
  namespace: string,
  kind: MCPListKind,
  sessionId: string | undefined,
): string | undefined {
  if (cursor === undefined) return undefined;
  if (
    typeof cursor !== "string" ||
    cursor.length === 0 ||
    cursor.length > MAX_MCP_LIST_CURSOR_LENGTH
  ) {
    throw new JsonRpcError(-32602, "List cursor must be a non-empty opaque string");
  }

  try {
    const bytes = base64urlDecodeBytes(cursor);
    if (bytes === undefined) throw new Error("invalid encoding");
    const decoded = JSON.parse(mcpCursorDecoder.decode(bytes));
    if (
      !Array.isArray(decoded) ||
      decoded.length !== 5 ||
      decoded[0] !== 1 ||
      decoded[1] !== namespace ||
      decoded[2] !== kind ||
      decoded[3] !== (sessionId ?? null) ||
      typeof decoded[4] !== "string" ||
      decoded[4].length === 0
    ) {
      throw new Error("invalid cursor payload");
    }
    return decoded[4];
  } catch {
    throw new JsonRpcError(-32602, "List cursor is invalid for this endpoint and session");
  }
}

function paginateEntries<T>(
  entries: Array<readonly [string, T]>,
  params: JSONRPCParams | undefined,
  namespace: string,
  kind: MCPListKind,
  sessionId?: string,
): { entries: Array<readonly [string, T]>; nextCursor?: string } {
  if (params !== undefined && Array.isArray(params)) {
    throw new JsonRpcError(-32602, "List params must be an object");
  }
  const cursor = decodeListCursor(
    params?.cursor,
    namespace,
    kind,
    sessionId,
  );
  let start = 0;
  if (cursor !== undefined) {
    const cursorIndex = entries.findIndex(([id]) => id === cursor);
    if (cursorIndex < 0) {
      throw new JsonRpcError(-32602, "List cursor no longer identifies a visible item");
    }
    start = cursorIndex + 1;
  }

  const page = entries.slice(start, start + MCP_LIST_PAGE_SIZE);
  const hasMore = start + page.length < entries.length;
  return {
    entries: page,
    ...(hasMore
      ? {
        nextCursor: encodeListCursor(
          namespace,
          kind,
          sessionId,
          page.at(-1)![0],
        ),
      }
      : {}),
  };
}

function isBoundedMCPText(value: unknown): value is string {
  return typeof value === "string" &&
    value.length <= MAX_MCP_TEXT_CONTENT_BYTES &&
    mcpTextEncoder.encode(value).byteLength <= MAX_MCP_TEXT_CONTENT_BYTES;
}

interface JSONRPCRequest {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: JSONRPCParams;
}

interface JSONRPCResponse {
  jsonrpc: "2.0";
  id?: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface PendingTaskRun {
  promise: Promise<void>;
  abortController: AbortController;
  scope: string | undefined;
}

interface PendingForegroundRequest {
  abortController: AbortController;
  scope: string | undefined;
}

function pendingRequestKey(requestId: string | number, sessionId?: string): string {
  return JSON.stringify([sessionId ?? null, typeof requestId, requestId]);
}

function readBearerToken(request: Request): string | undefined {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) return undefined;
  const bearerMatch = /^Bearer +([A-Za-z0-9._~+/-]+=*)$/i.exec(
    authHeader.trim(),
  );
  return bearerMatch?.[1];
}

interface CallToolResult extends Record<string, unknown> {
  content: Array<{ type: "text"; text: string }>;
  isError: boolean;
  _meta?: Record<string, unknown>;
}

function toolErrorMessage(error: unknown): string {
  return snapshotThrowableDiagnostic(error) || "Tool execution failed";
}

function toolErrorResult(message: string): CallToolResult {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

function toolSuccessResult(result: unknown): CallToolResult {
  const snapshot = snapshotBoundedJsonValue(result);
  if (!snapshot.success) {
    return toolErrorResult(
      "Tool result must be bounded, data-only JSON",
    );
  }
  const text = JSON.stringify(snapshot.value);
  if (!isBoundedMCPText(text)) {
    return toolErrorResult(
      "Tool result exceeds the MCP response limit",
    );
  }
  return {
    content: [{
      type: "text",
      text,
    }],
    isError: false,
  };
}

function withRelatedTaskMetadata(
  result: Record<string, unknown>,
  taskId: string,
): Record<string, unknown> {
  const existingMeta = result._meta;
  const meta = existingMeta !== null &&
      typeof existingMeta === "object" &&
      !Array.isArray(existingMeta)
    ? existingMeta as Record<string, unknown>
    : {};
  return {
    ...result,
    _meta: {
      ...meta,
      "io.modelcontextprotocol/related-task": { taskId },
    },
  };
}

function normalizePromptArguments(
  prompt: Prompt,
  args: unknown,
): Record<string, string> | undefined {
  if (args === undefined) {
    for (const argument of prompt.mcp?.arguments ?? []) {
      if (argument.required === true) {
        throw new JsonRpcError(
          -32602,
          `Missing required prompt argument: "${argument.name}"`,
        );
      }
    }
    return undefined;
  }

  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    throw new JsonRpcError(-32602, "Prompt arguments must be an object");
  }

  const snapshot = snapshotBoundedJsonValue(args);
  if (
    !snapshot.success ||
    snapshot.value === null ||
    typeof snapshot.value !== "object" ||
    Array.isArray(snapshot.value)
  ) {
    throw new JsonRpcError(-32602, "Prompt arguments must be an object");
  }

  const entries = Object.entries(snapshot.value);
  for (const [name, value] of entries) {
    if (typeof value !== "string") {
      throw new JsonRpcError(-32602, `Prompt argument "${name}" must be a string`);
    }
  }

  const declaredArguments = prompt.mcp?.arguments;
  if (declaredArguments !== undefined) {
    const declaredNames = new Set(declaredArguments.map(({ name }) => name));
    for (const [name] of entries) {
      if (!declaredNames.has(name)) {
        throw new JsonRpcError(-32602, `Unknown prompt argument: "${name}"`);
      }
    }
    const providedNames = new Set(entries.map(([name]) => name));
    for (const argument of declaredArguments) {
      if (argument.required === true && !providedNames.has(argument.name)) {
        throw new JsonRpcError(
          -32602,
          `Missing required prompt argument: "${argument.name}"`,
        );
      }
    }
  }

  return Object.fromEntries(entries) as Record<string, string>;
}

/**
 * Whether an Origin header points at the local loopback interface (any port).
 * Used as the default Origin allowlist when none is configured.
 */
function isLoopbackOrigin(origin: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.origin !== origin ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    return false;
  }
  const hostname = parsed.hostname;
  return hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]";
}

/**
 * Exposes registered tools, resources, and prompts through MCP dispatch and
 * the built-in session-based HTTP transport.
 */
export class MCPServer {
  private config: MCPServerConfig;
  private sessionManager: SessionManager;
  private taskStore: TaskStore;
  private pendingTasks = new Map<string, PendingTaskRun>();
  private pendingRequestAbortControllers = new Map<
    string,
    PendingForegroundRequest
  >();
  private clientCapabilities: Record<string, unknown> = {};
  private clientProtocolVersion: MCPSupportedProtocolVersion = MCP_LATEST_PROTOCOL_VERSION;
  private sessionCapabilities = new Map<string, Record<string, unknown>>();
  private sessionAuthBindings = new Map<string, string>();
  private sessionProtocolVersions = new Map<
    string,
    MCPSupportedProtocolVersion
  >();
  private readonly listCursorNamespace = crypto.randomUUID();

  /**
   * Callback for custom transports that can deliver server-initiated
   * notifications. The built-in Streamable HTTP transport does not install
   * one and therefore does not advertise list-change support.
   */
  onNotification?: (notification: { jsonrpc: "2.0"; method: string; params?: unknown }) => void;

  constructor(config: MCPServerConfig) {
    this.config = MCPServer.normalizeConfig(config);
    this.taskStore = new TaskStore();
    this.sessionManager = new SessionManager({
      onSessionRemoved: (sessionId) => this.releaseSessionState(sessionId),
    });

    if (this.config.enabled && this.config.auth.type === "none") {
      logger.warn(
        "MCP server started with auth.type='none' (allowUnauthenticated) — all requests will be accepted",
      );
    }
  }

  /**
   * Fail-closed validation of the auth configuration (VULN-SRV-5).
   *
   * Historically, an unset `auth` field — or `{ type: "none" }` — silently
   * accepted every request with only a warning log. That meant an operator who
   * forgot to configure auth shipped an unauthenticated JSON-RPC surface.
   *
   * The new contract: `auth` is required, and the only way to accept
   * unauthenticated traffic is to explicitly set
   * `{ type: "none", allowUnauthenticated: true }`. Any other shape is
   * rejected at construction time.
   */
  private static validateAuthConfig(config: MCPServerConfig): void {
    if (config === null || typeof config !== "object") {
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
      const validate = (auth as { validate?: unknown }).validate;
      if (validate !== undefined && typeof validate !== "function") {
        throw CONFIG_INVALID.create({
          detail: "MCP bearer auth validate must be a function when provided.",
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

  private static normalizeConfig(config: MCPServerConfig): MCPServerConfig {
    MCPServer.validateAuthConfig(config);

    if (typeof config.enabled !== "boolean") {
      throw CONFIG_INVALID.create({
        detail: "MCP enabled must be a boolean.",
      });
    }
    if (
      config.port !== undefined &&
      (
        !Number.isSafeInteger(config.port) ||
        config.port <= 0 ||
        config.port > 65_535
      )
    ) {
      throw CONFIG_INVALID.create({
        detail: "MCP port must be an integer between 1 and 65535.",
      });
    }

    let cors: MCPServerConfig["cors"];
    if (config.cors !== undefined) {
      if (
        config.cors === null ||
        typeof config.cors !== "object" ||
        Array.isArray(config.cors) ||
        typeof config.cors.enabled !== "boolean"
      ) {
        throw CONFIG_INVALID.create({
          detail: "MCP CORS configuration must include a boolean enabled field.",
        });
      }

      let origins: string[] | undefined;
      if (config.cors.origins !== undefined) {
        if (!Array.isArray(config.cors.origins)) {
          throw CONFIG_INVALID.create({
            detail: "MCP CORS origins must be an array of absolute origins.",
          });
        }
        origins = [];
        for (const origin of config.cors.origins) {
          if (typeof origin !== "string") {
            throw CONFIG_INVALID.create({
              detail: "MCP CORS origins must contain only strings.",
            });
          }
          let parsed: URL;
          try {
            parsed = new URL(origin);
          } catch {
            throw CONFIG_INVALID.create({
              detail: `MCP CORS origin is invalid: ${origin}`,
            });
          }
          if (
            parsed.origin === "null" ||
            parsed.origin !== origin ||
            (parsed.protocol !== "https:" && parsed.protocol !== "http:")
          ) {
            throw CONFIG_INVALID.create({
              detail: `MCP CORS origin must be a canonical HTTP(S) origin: ${origin}`,
            });
          }
          if (!origins.includes(origin)) origins.push(origin);
        }
      }
      cors = {
        enabled: config.cors.enabled,
        ...(origins === undefined ? {} : { origins }),
      };
    }

    const auth: MCPServerConfig["auth"] = config.auth.type === "none"
      ? { type: "none", allowUnauthenticated: true }
      : {
        type: "bearer",
        ...(config.auth.validate === undefined ? {} : { validate: config.auth.validate }),
      };

    return {
      enabled: config.enabled,
      ...(config.port === undefined ? {} : { port: config.port }),
      auth,
      ...(cors === undefined ? {} : { cors }),
    };
  }

  /** Emit on an explicitly wired notification-capable custom transport. */
  notifyToolsChanged(): void {
    this.onNotification?.({ jsonrpc: "2.0", method: "notifications/tools/list_changed" });
  }

  /** Emit on an explicitly wired notification-capable custom transport. */
  notifyResourcesChanged(): void {
    this.onNotification?.({ jsonrpc: "2.0", method: "notifications/resources/list_changed" });
  }

  /** Emit on an explicitly wired notification-capable custom transport. */
  notifyPromptsChanged(): void {
    this.onNotification?.({ jsonrpc: "2.0", method: "notifications/prompts/list_changed" });
  }

  clientSupportsElicitation(mode: "form" | "url", sessionId?: string): boolean {
    const capabilities = sessionId
      ? this.sessionCapabilities.get(sessionId) ?? {}
      : this.clientCapabilities;
    const raw = capabilities.elicitation;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const elicitation = raw as Record<string, unknown>;
    // Per MCP spec: empty elicitation object implies basic form support (backwards compat)
    if (mode === "form" && Object.keys(elicitation).length === 0) return true;
    return mode in elicitation;
  }

  handleRequest(
    request: JSONRPCRequest,
    context?: ToolExecutionContext,
    sessionId?: string,
  ): Promise<JSONRPCResponse> {
    if (!this.config.enabled) {
      return Promise.resolve({
        jsonrpc: "2.0",
        id: request.id,
        error: { code: -32601, message: "MCP server is disabled" },
      });
    }
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
      { "mcp.method": request.method },
    );
  }

  private dispatch(
    method: string,
    params: JSONRPCParams | undefined,
    context?: ToolExecutionContext,
    requestId?: string | number,
    sessionId?: string,
  ): Promise<unknown> {
    switch (method) {
      case "tools/list":
        return this.listTools(params, sessionId);
      case "tools/call":
        return this.callTool(params, context, requestId, sessionId);
      case "resources/list":
        return this.listResources(params, sessionId);
      case "resources/read":
        return this.readResource(params, context, requestId, sessionId);
      case "resources/templates/list":
        return this.listResourceTemplates(params, sessionId);
      case "prompts/list":
        return this.listPrompts(params, sessionId);
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
      case "tasks/get":
        this.assertTasksSupported(sessionId);
        return this.getTask(params, sessionId);
      case "tasks/result":
        this.assertTasksSupported(sessionId);
        return this.getTaskResult(params, context, requestId, sessionId);
      case "tasks/cancel":
        this.assertTasksSupported(sessionId);
        return this.cancelTask(params, sessionId);
      case "tasks/list":
        this.assertTasksSupported(sessionId);
        return this.listTasks(params, sessionId);
      default:
        throw new JsonRpcError(-32601, `Method not found: ${method}`);
    }
  }

  private initialize(params: JSONRPCParams | undefined): Promise<Record<string, unknown>> {
    const p = toParamsRecord(params);
    const requested = typeof p.protocolVersion === "string" ? p.protocolVersion : undefined;
    const negotiated = isSupportedMCPProtocolVersion(requested)
      ? requested
      : MCP_LATEST_PROTOCOL_VERSION;
    this.clientProtocolVersion = negotiated;

    const clientCaps = snapshotObject(
      p.capabilities ?? {},
      "Client capabilities must be a bounded, data-only JSON object",
      -32602,
    );
    this.clientCapabilities = clientCaps;

    const listCapability = this.onNotification === undefined ? {} : { listChanged: true };
    const capabilities: Record<string, unknown> = {
      tools: { ...listCapability },
      resources: { ...listCapability },
      prompts: { ...listCapability },
    };
    if (negotiated === "2025-11-25") {
      capabilities.tasks = {
        list: {},
        cancel: {},
        requests: { tools: { call: {} } },
      };
    }

    return Promise.resolve({
      protocolVersion: negotiated,
      serverInfo: {
        name: "veryfront-mcp",
        title: "Veryfront MCP Server",
        version: VERSION,
        description:
          "Veryfront MCP server exposing the tools, resources, and prompts registered by the application",
      },
      capabilities,
      instructions:
        "Use tools/list, resources/list, and prompts/list to discover the capabilities registered by this application.",
    });
  }

  private async listTools(
    params?: JSONRPCParams,
    sessionId?: string,
  ): Promise<{ tools: ToolListEntry[]; nextCursor?: string }> {
    const registry = getMCPRegistry();
    const tools: ToolListEntry[] = [];
    const visibleEntries = Array.from(registry.tools.entries()).filter(
      ([, tool]) =>
        tool.mcp?.enabled !== false &&
        tool.ownerAgentId === undefined,
    );
    const page = paginateEntries(
      visibleEntries,
      params,
      this.listCursorNamespace,
      "tools",
      sessionId,
    );

    for (const [id, tool] of page.entries) {
      const inputSchema = snapshotObject(
        tool.inputSchemaJson ?? zodToJsonSchema(tool.inputSchema),
        `Tool "${id}" has invalid MCP input schema metadata`,
      );
      if (inputSchema.type !== "object") {
        throw new JsonRpcError(
          -32603,
          `Tool "${id}" MCP input schema must have an object root`,
        );
      }

      const entry: ToolListEntry = {
        name: id,
        description: tool.description,
        inputSchema,
      };
      if (this.supportsTasks(sessionId)) {
        entry.execution = { taskSupport: "optional" };
      }
      if (tool.mcp?.title) entry.title = tool.mcp.title;
      if (tool.mcp?.annotations) {
        entry.annotations = snapshotObject(
          tool.mcp.annotations,
          `Tool "${id}" has invalid MCP annotations`,
        );
      }
      tools.push(entry);
    }

    return {
      tools,
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
    };
  }

  private callTool(
    params: JSONRPCParams | undefined,
    context?: ToolExecutionContext,
    requestId?: string | number,
    sessionId?: string,
  ): Promise<Record<string, unknown>> {
    const p = toParamsRecord(params);
    const { name, arguments: args } = p;
    const rawMeta = p._meta;
    const meta = rawMeta !== null &&
        typeof rawMeta === "object" &&
        !Array.isArray(rawMeta)
      ? rawMeta as Record<string, unknown>
      : {};
    const rawToken = meta.progressToken;
    const progressToken = (typeof rawToken === "string" || typeof rawToken === "number")
      ? rawToken
      : undefined;

    if (typeof name !== "string" || name.length === 0) {
      throw new JsonRpcError(-32602, "Tool name must be a non-empty string");
    }

    const toolName = name;

    const registry = getMCPRegistry();
    const tool = registry.tools.get(toolName);
    if (
      !tool ||
      tool.ownerAgentId !== undefined ||
      tool.mcp?.enabled === false
    ) {
      throw new JsonRpcError(-32602, `Unknown tool: ${toolName}`);
    }

    if (tool.inputSchema && typeof tool.inputSchema.parse === "function") {
      try {
        tool.inputSchema.parse(args ?? {});
      } catch (error) {
        const message = snapshotThrowableDiagnostic(error) ||
          "Input did not satisfy the tool schema";
        throw new JsonRpcError(-32602, `Invalid arguments for tool ${toolName}: ${message}`);
      }
    }

    const toolContext: ToolExecutionContext | undefined = progressToken !== undefined
      ? { ...context, progressToken }
      : context;

    // Async task mode: if the caller provides a `task` field, create a task
    // and run the tool in the background, returning the task immediately.
    if (p.task !== undefined && this.supportsTasks(sessionId)) {
      const taskSnapshot = snapshotBoundedJsonValue(p.task);
      if (
        !taskSnapshot.success ||
        taskSnapshot.value === null ||
        typeof taskSnapshot.value !== "object" ||
        Array.isArray(taskSnapshot.value)
      ) {
        throw new JsonRpcError(-32602, "Task metadata must be an object");
      }
      const taskParam = taskSnapshot.value;
      const MIN_TTL = 1000;
      const MAX_TTL = 3_600_000; // 1 hour
      const rawTtl = taskParam.ttl ?? 60_000;
      if (
        typeof rawTtl !== "number" ||
        !Number.isSafeInteger(rawTtl) ||
        rawTtl <= 0
      ) {
        throw new JsonRpcError(
          -32602,
          "Task ttl must be a positive integer number of milliseconds",
        );
      }
      const ttl = Math.max(MIN_TTL, Math.min(MAX_TTL, rawTtl));
      let task: ReturnType<TaskStore["create"]>;
      try {
        task = this.taskStore.create(ttl, sessionId);
      } catch (error) {
        if (
          error instanceof VeryfrontError &&
          error.slug === SERVICE_OVERLOADED.slug
        ) {
          throw new JsonRpcError(-32000, "Task capacity reached");
        }
        throw error;
      }
      const abortController = new AbortController();
      const taskToolContext: ToolExecutionContext = {
        ...toolContext,
        abortSignal: abortController.signal,
      };

      // Run tool in background, update task on completion
      const pending = withSpan(
        "mcp.callTool.async",
        async () => {
          try {
            const result = await executeTool(toolName, args, taskToolContext);
            const toolResult = toolSuccessResult(result);
            if (toolResult.isError) {
              this.taskStore.fail(
                task.taskId,
                toolResult.content[0]!.text,
                sessionId,
                toolResult,
              );
            } else {
              this.taskStore.complete(task.taskId, toolResult, sessionId);
            }
          } catch (error) {
            if (this.taskStore.get(task.taskId, sessionId)?.status === "cancelled") {
              return;
            }
            const message = toolErrorMessage(error);
            logger.warn("Async tool execution failed", {
              tool: toolName,
              taskId: task.taskId,
              error: message,
            });
            this.taskStore.fail(
              task.taskId,
              message,
              sessionId,
              toolErrorResult(message),
            );
          }
        },
        { "mcp.tool.name": toolName, "mcp.task.id": task.taskId },
      ).finally(() => {
        this.pendingTasks.delete(task.taskId);
      });
      this.pendingTasks.set(task.taskId, {
        promise: pending,
        abortController,
        scope: sessionId,
      });

      return Promise.resolve({ task });
    }

    return withSpan(
      "mcp.callTool",
      () =>
        this.withForegroundRequestSignal(
          requestId,
          sessionId,
          toolContext?.abortSignal,
          async (abortSignal) => {
            const foregroundToolContext: ToolExecutionContext | undefined = abortSignal
              ? { ...toolContext, abortSignal }
              : toolContext;

            try {
              const result = await executeTool(toolName, args, foregroundToolContext);
              return toolSuccessResult(result);
            } catch (error) {
              return toolErrorResult(toolErrorMessage(error));
            }
          },
        ),
      { "mcp.tool.name": toolName },
    );
  }

  private async withForegroundRequestSignal<T>(
    requestId: string | number | undefined,
    sessionId: string | undefined,
    outerAbortSignal: AbortSignal | undefined,
    operation: (abortSignal: AbortSignal | undefined) => Promise<T>,
  ): Promise<T> {
    const abortController = requestId === undefined ? undefined : new AbortController();
    const abortFromOuterSignal = () => abortController?.abort(outerAbortSignal?.reason);
    const requestKey = requestId === undefined
      ? undefined
      : pendingRequestKey(requestId, sessionId);

    if (abortController) {
      if (this.pendingRequestAbortControllers.has(requestKey!)) {
        throw new JsonRpcError(
          -32600,
          `Duplicate in-flight JSON-RPC request id: ${String(requestId)}`,
        );
      }
      if (outerAbortSignal?.aborted) {
        abortController.abort(outerAbortSignal.reason);
      } else {
        outerAbortSignal?.addEventListener("abort", abortFromOuterSignal, { once: true });
      }
      this.pendingRequestAbortControllers.set(requestKey!, {
        abortController,
        scope: sessionId,
      });
    }

    try {
      return await operation(abortController?.signal ?? outerAbortSignal);
    } finally {
      if (
        requestKey !== undefined &&
        this.pendingRequestAbortControllers.get(requestKey)?.abortController ===
          abortController
      ) {
        this.pendingRequestAbortControllers.delete(requestKey);
      }
      outerAbortSignal?.removeEventListener("abort", abortFromOuterSignal);
    }
  }

  private listResourceTemplates(
    params?: JSONRPCParams,
    sessionId?: string,
  ): Promise<{
    resourceTemplates: Array<Record<string, unknown>>;
    nextCursor?: string;
  }> {
    const registry = getMCPRegistry();
    const templates: Array<Record<string, unknown>> = [];
    const visibleEntries = Array.from(registry.resources.entries()).filter(
      ([, resource]) =>
        resource.mcp?.enabled !== false &&
        resourceRegistry.isTemplatePattern(resource.pattern),
    );
    const page = paginateEntries(
      visibleEntries,
      params,
      this.listCursorNamespace,
      "resourceTemplates",
      sessionId,
    );

    for (const [id, resource] of page.entries) {
      const uriTemplate = resourceRegistry.toUriTemplate(resource.pattern);
      const entry: Record<string, unknown> = {
        uriTemplate,
        name: id,
        description: resource.description,
        mimeType: getResourceMCPMimeType(resource),
      };
      if (resource.title) entry.title = resource.title;
      templates.push(entry);
    }

    return Promise.resolve({
      resourceTemplates: templates,
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
    });
  }

  private listResources(
    params?: JSONRPCParams,
    sessionId?: string,
  ): Promise<{ resources: Array<Record<string, unknown>>; nextCursor?: string }> {
    const registry = getMCPRegistry();
    const resources: Array<Record<string, unknown>> = [];
    const visibleEntries = Array.from(registry.resources.entries()).filter(
      ([, resource]) =>
        resource.mcp?.enabled !== false &&
        !resourceRegistry.isTemplatePattern(resource.pattern),
    );
    const page = paginateEntries(
      visibleEntries,
      params,
      this.listCursorNamespace,
      "resources",
      sessionId,
    );

    for (const [id, resource] of page.entries) {
      const entry: Record<string, unknown> = {
        uri: resource.pattern,
        name: id,
        description: resource.description,
        mimeType: getResourceMCPMimeType(resource),
      };
      if (resource.title) entry.title = resource.title;
      resources.push(entry);
    }

    return Promise.resolve({
      resources,
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
    });
  }

  private readResource(
    params: JSONRPCParams | undefined,
    context?: ToolExecutionContext,
    requestId?: string | number,
    sessionId?: string,
  ): Promise<Record<string, unknown>> {
    const { uri } = toParamsRecord(params);

    if (typeof uri !== "string" || uri.length === 0) {
      throw new JsonRpcError(-32602, "Resource URI must be a non-empty string");
    }

    const resourceUri = uri;
    let resourceEntry: ReturnType<typeof resourceRegistry.findEntryByPattern>;
    try {
      resourceEntry = resourceRegistry.findEntryByPattern(resourceUri);
    } catch (error) {
      if (error instanceof ResourceUriSyntaxError) {
        throw new JsonRpcError(-32602, error.message);
      }
      throw new JsonRpcError(-32603, "Resource URI could not be resolved");
    }

    // Hidden resources must be indistinguishable from absent resources. This
    // check applies to direct reads as well as list endpoints so guessing a URI
    // cannot bypass an explicit MCP exposure opt-out.
    if (!resourceEntry || resourceEntry[1].mcp?.enabled === false) {
      throw new JsonRpcError(-32002, `Resource not found: ${resourceUri}`);
    }
    const [resourceId, resource] = resourceEntry;

    return withSpan(
      "mcp.readResource",
      () =>
        this.withForegroundRequestSignal(
          requestId,
          sessionId,
          context?.abortSignal,
          async (abortSignal) => {
            let resourceParams: Record<string, string>;
            try {
              resourceParams = resourceRegistry.extractParams(
                resourceUri,
                resource.pattern,
              );
            } catch (error) {
              if (error instanceof ResourceUriValidationError) {
                throw new JsonRpcError(-32602, error.message);
              }
              throw new JsonRpcError(
                -32603,
                `Resource "${resourceId}" could not be resolved`,
              );
            }
            let data: unknown;
            try {
              data = await resource.load(
                resourceParams,
                abortSignal ? { abortSignal, uri: resourceUri } : { uri: resourceUri },
              );
            } catch (error) {
              if (error instanceof ResourceParamsValidationError) {
                throw new JsonRpcError(
                  -32602,
                  `Resource URI does not satisfy parameters for "${resourceId}"`,
                );
              }
              logger.warn("Resource loading failed", {
                resource: resourceId,
                errorType: error instanceof Error ? error.name : typeof error,
              });
              throw new JsonRpcError(
                -32603,
                `Resource "${resourceId}" could not be loaded`,
              );
            }

            try {
              return {
                contents: [
                  toMCPResourceContents(
                    resourceId,
                    resource,
                    data,
                    resourceUri,
                  ),
                ],
              };
            } catch (error) {
              if (error instanceof ResourceContentValidationError) {
                throw new JsonRpcError(-32603, error.message);
              }
              throw new JsonRpcError(
                -32603,
                `Resource "${resourceId}" could not be encoded`,
              );
            }
          },
        ),
      {
        "mcp.resource.id": resourceId,
        "mcp.resource.pattern": resource.pattern,
      },
    );
  }

  private listPrompts(
    params?: JSONRPCParams,
    sessionId?: string,
  ): Promise<{ prompts: Array<Record<string, unknown>>; nextCursor?: string }> {
    const registry = getMCPRegistry();
    const prompts: Array<Record<string, unknown>> = [];
    const visibleEntries = Array.from(registry.prompts.entries()).filter(
      ([, promptInstance]) => promptInstance.mcp?.enabled !== false,
    );
    const page = paginateEntries(
      visibleEntries,
      params,
      this.listCursorNamespace,
      "prompts",
      sessionId,
    );

    for (const [id, promptInstance] of page.entries) {
      const entry: Record<string, unknown> = {
        name: id,
        description: promptInstance.description,
      };
      if (promptInstance.mcp?.title !== undefined) {
        entry.title = promptInstance.mcp.title;
      }
      if (promptInstance.mcp?.arguments !== undefined) {
        entry.arguments = promptInstance.mcp.arguments.map((argument) => {
          const listedArgument: Record<string, unknown> = { name: argument.name };
          if (argument.title !== undefined) listedArgument.title = argument.title;
          if (argument.description !== undefined) {
            listedArgument.description = argument.description;
          }
          if (argument.required !== undefined) listedArgument.required = argument.required;
          return listedArgument;
        });
      }
      prompts.push(entry);
    }

    return Promise.resolve({
      prompts,
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
    });
  }

  private getPrompt(
    params: JSONRPCParams | undefined,
    context?: ToolExecutionContext,
    requestId?: string | number,
    sessionId?: string,
  ): Promise<Record<string, unknown>> {
    const { name, arguments: args } = toParamsRecord(params);

    if (typeof name !== "string" || name.length === 0) {
      throw new JsonRpcError(-32602, "Prompt name must be a non-empty string");
    }

    const promptName = name;
    const registeredPrompt = promptRegistry.get(promptName);
    if (!registeredPrompt || registeredPrompt.mcp?.enabled === false) {
      throw new JsonRpcError(-32602, `Unknown prompt: ${promptName}`);
    }
    const promptArguments = normalizePromptArguments(registeredPrompt, args);

    return withSpan(
      "mcp.getPrompt",
      () =>
        this.withForegroundRequestSignal(
          requestId,
          sessionId,
          context?.abortSignal,
          async (abortSignal) => {
            let content: string;
            try {
              content = await registeredPrompt.getContent(
                promptArguments,
                abortSignal ? { abortSignal } : undefined,
              );
            } catch (error) {
              logger.warn("Prompt rendering failed", {
                prompt: promptName,
                errorType: error instanceof Error ? error.name : typeof error,
              });
              throw new JsonRpcError(
                -32603,
                `Prompt "${promptName}" could not be rendered`,
              );
            }
            if (!isBoundedMCPText(content)) {
              throw new JsonRpcError(
                -32603,
                `Prompt "${promptName}" returned invalid content`,
              );
            }

            return {
              description: registeredPrompt.description,
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
          },
        ),
      { "mcp.prompt.name": promptName },
    );
  }

  private cancelRequest(
    params: JSONRPCParams | undefined,
    sessionId?: string,
  ): Promise<Record<string, unknown>> {
    const { requestId } = toParamsRecord(params);
    if (typeof requestId !== "string" && typeof requestId !== "number") {
      return Promise.resolve({});
    }

    this.pendingRequestAbortControllers
      .get(pendingRequestKey(requestId, sessionId))
      ?.abortController.abort();
    return Promise.resolve({});
  }

  private getTask(
    params: JSONRPCParams | undefined,
    sessionId?: string,
  ): Promise<Record<string, unknown>> {
    const { taskId } = toParamsRecord(params);
    if (typeof taskId !== "string" || taskId.length === 0) {
      throw new JsonRpcError(-32602, "taskId must be a non-empty string");
    }
    const task = this.taskStore.get(taskId, sessionId);
    if (!task) {
      throw new JsonRpcError(-32602, `Task not found: ${taskId}`);
    }
    return Promise.resolve({ ...task });
  }

  private async getTaskResult(
    params: JSONRPCParams | undefined,
    context?: ToolExecutionContext,
    requestId?: string | number,
    sessionId?: string,
  ): Promise<Record<string, unknown>> {
    const { taskId } = toParamsRecord(params);
    if (typeof taskId !== "string" || taskId.length === 0) {
      throw new JsonRpcError(-32602, "taskId must be a non-empty string");
    }
    const task = this.taskStore.get(taskId, sessionId);
    if (!task) {
      throw new JsonRpcError(-32602, `Task not found: ${taskId}`);
    }
    return await this.withForegroundRequestSignal(
      requestId,
      sessionId,
      context?.abortSignal,
      async (abortSignal) => {
        const result = await this.taskStore.waitForResult(
          taskId,
          sessionId,
          abortSignal,
        );
        if (result === undefined) {
          throw new JsonRpcError(-32603, `Task ended without a result: ${taskId}`);
        }
        if (result === null || typeof result !== "object" || Array.isArray(result)) {
          throw new JsonRpcError(-32603, `Task result is invalid: ${taskId}`);
        }
        return withRelatedTaskMetadata(result as Record<string, unknown>, taskId);
      },
    );
  }

  private cancelTask(
    params: JSONRPCParams | undefined,
    sessionId?: string,
  ): Promise<Record<string, unknown>> {
    const { taskId } = toParamsRecord(params);
    if (typeof taskId !== "string" || taskId.length === 0) {
      throw new JsonRpcError(-32602, "taskId must be a non-empty string");
    }
    const cancellationResult = toolErrorResult(
      "The task was cancelled by request.",
    );
    if (
      !this.taskStore.get(taskId, sessionId) ||
      !this.taskStore.cancel(
        taskId,
        sessionId,
        cancellationResult,
      )
    ) {
      throw new JsonRpcError(-32602, `Cannot cancel task: ${taskId}`);
    }
    const pending = this.pendingTasks.get(taskId);
    if (pending !== undefined && pending.scope === sessionId) {
      pending.abortController.abort(
        new DOMException("The task was cancelled by request.", "AbortError"),
      );
    }
    return Promise.resolve({ ...this.taskStore.get(taskId, sessionId)! });
  }

  private listTasks(
    params: JSONRPCParams | undefined,
    sessionId?: string,
  ): Promise<Record<string, unknown>> {
    const { cursor } = toParamsRecord(params);
    if (cursor !== undefined && (typeof cursor !== "string" || cursor.length === 0)) {
      throw new JsonRpcError(-32602, "Task cursor must be a non-empty string");
    }
    try {
      return Promise.resolve({
        ...this.taskStore.listPage(
          sessionId,
          cursor as string | undefined,
        ),
      });
    } catch (error) {
      if (error instanceof TypeError) {
        throw new JsonRpcError(-32602, error.message);
      }
      throw error;
    }
  }

  private supportsTasks(sessionId?: string): boolean {
    const version = sessionId === undefined
      ? this.clientProtocolVersion
      : this.sessionProtocolVersions.get(sessionId);
    return version === "2025-11-25";
  }

  private assertTasksSupported(sessionId?: string): void {
    if (!this.supportsTasks(sessionId)) {
      throw new JsonRpcError(
        -32601,
        "Task operations are not available for this protocol version",
      );
    }
  }

  /** Wait for all background task executions to settle. Useful in tests. */
  waitForPendingTasks(): Promise<void> {
    return Promise.all(Array.from(this.pendingTasks.values(), (run) => run.promise)).then(() => {});
  }

  private releaseSessionState(sessionId: string): void {
    this.sessionCapabilities.delete(sessionId);
    this.sessionAuthBindings.delete(sessionId);
    this.sessionProtocolVersions.delete(sessionId);

    const abortReason = new DOMException("The MCP session ended.", "AbortError");
    for (const [requestKey, request] of this.pendingRequestAbortControllers) {
      if (request.scope !== sessionId) continue;
      this.pendingRequestAbortControllers.delete(requestKey);
      request.abortController.abort(abortReason);
    }
    for (const run of this.pendingTasks.values()) {
      if (run.scope === sessionId) {
        run.abortController.abort(abortReason);
      }
    }
    this.taskStore.removeScope(sessionId);
  }

  createHTTPHandler(): (request: Request) => Promise<Response> {
    if (!this.config.enabled) {
      return () =>
        Promise.resolve(
          new Response("Not Found", {
            status: 404,
            headers: {
              "Cache-Control": "no-store",
              "X-Content-Type-Options": "nosniff",
            },
          }),
        );
    }
    return createMCPHTTPHandler({
      authEnabled: this.config.auth.type !== "none",
      getCORSHeaders: (requestOrigin) => this.getCORSHeaders(requestOrigin),
      validateAuth: (request) => this.validateAuth(request),
      getAuthBinding: (request) => this.getAuthBinding(request),
      handleRequest: (request, context, sessionId) =>
        this.handleRequest(request, context, sessionId),
      extractRequestContext: () => this.extractRequestContext(),
      isOriginAllowed: (requestOrigin) => this.isOriginAllowed(requestOrigin),
      sessionCapabilities: this.sessionCapabilities,
      sessionAuthBindings: this.sessionAuthBindings,
      sessionProtocolVersions: this.sessionProtocolVersions,
      sessionManager: this.sessionManager,
    });
  }

  private extractRequestContext(): ToolExecutionContext | undefined {
    // HTTP headers are caller-controlled. In particular, projectId can select
    // project-scoped remote tools and credentials, so it must come from a
    // trusted host context rather than an arbitrary X-Project-Id header.
    // Request.signal is intentionally not forwarded: MCP disconnects are not
    // cancellations; clients use notifications/cancelled or tasks/cancel.
    return undefined;
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

  private async validateAuth(request: Request): Promise<boolean> {
    const auth = this.config.auth;
    if (auth.type === "none") return true;

    // Parse strictly: accept only "Bearer <token>" (scheme case-insensitive) and
    // reject other/no-scheme headers rather than passing a malformed value on.
    const token = readBearerToken(request);
    if (!token) return false;

    // When bearer auth is configured without a validate function, reject all requests
    if (!auth.validate) {
      logger.warn("Bearer auth configured without validate function — rejecting request");
      return false;
    }

    return await auth.validate(token);
  }

  private async getAuthBinding(request: Request): Promise<string | undefined> {
    if (this.config.auth.type === "none") return undefined;
    const token = readBearerToken(request);
    return token === undefined
      ? undefined
      : await computeHash(`veryfront:mcp:session-auth\u0000${token}`);
  }

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
        "Content-Type, Authorization, MCP-Session-Id, MCP-Protocol-Version",
      "Vary": "Origin",
    };
  }
}

/** Create an application-facing MCP server from validated configuration. */
export function createMCPServer(config: MCPServerConfig): MCPServer {
  return new MCPServer(config);
}
