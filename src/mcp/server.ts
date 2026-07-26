import { getMCPRegistry } from "./registry.ts";
import { executeTool } from "#veryfront/tool";
import type { ToolExecutionContext } from "#veryfront/tool";
import { zodToJsonSchema } from "#veryfront/tool/schema/index.ts";
import { resourceRegistry } from "#veryfront/resource";
import { promptRegistry } from "#veryfront/prompt";
import type { Prompt } from "#veryfront/prompt";
import type { MCPServerConfig, ToolListEntry } from "./types.ts";
import { CONFIG_INVALID, createError, toError } from "#veryfront/errors";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { VERSION } from "#veryfront/utils/version.ts";
import { logger as baseLogger } from "#veryfront/utils";
import { createMCPHTTPHandler } from "./http-transport.ts";
import { SessionManager } from "./session.ts";
import { TaskStore } from "./task-store.ts";
import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import {
  ResourceParamsValidationError,
  ResourceUriSyntaxError,
  ResourceUriValidationError,
} from "#veryfront/resource/errors.ts";
import { getResourceMCPMimeType, toMCPResourceContents } from "#veryfront/resource/mcp-content.ts";

const logger = baseLogger.component("mcp-server");
const MAX_CONTEXT_HEADER_LENGTH = 255;
const PROJECT_ID_PATTERN = /^[a-zA-Z0-9._-]+$/;

type JSONRPCParams = Record<string, unknown> | unknown[];

class JsonRpcError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

function errorCode(error: unknown): number {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "number") return code;
  }
  return -32603;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
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
}

function pendingRequestKey(requestId: string | number, sessionId?: string): string {
  return JSON.stringify([sessionId ?? null, typeof requestId, requestId]);
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
  let hostname: string;
  try {
    hostname = new URL(origin).hostname;
  } catch {
    return false;
  }
  return hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]";
}

const MCP_SUPPORTED_VERSIONS = ["2025-11-25", "2024-11-05"];

/** Implement mcpserver. */
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
  private sessionManager = new SessionManager();
  private taskStore = new TaskStore();
  private pendingTasks = new Map<string, PendingTaskRun>();
  private pendingRequestAbortControllers = new Map<string, AbortController>();
  private clientCapabilities: Record<string, unknown> = {};
  private sessionCapabilities = new Map<string, Record<string, unknown>>();

  /**
   * Callback for custom transports that can deliver server-initiated
   * notifications. The built-in Streamable HTTP transport does not install
   * one and therefore does not advertise list-change support.
   */
  onNotification?: (notification: { jsonrpc: "2.0"; method: string; params?: unknown }) => void;

  constructor(config: MCPServerConfig) {
    MCPServer.validateAuthConfig(config);
    this.config = config;

    if (config.auth.type === "none") {
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
        return this.listTools(params);
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
      case "completion/complete":
        return this.complete(params);
      case "logging/setLevel":
        return this.setLogLevel(params);
      case "tasks/get":
        return this.getTask(params);
      case "tasks/result":
        return this.getTaskResult(params);
      case "tasks/cancel":
        return this.cancelTask(params);
      case "tasks/list":
        return this.listTasks();
      default:
        throw toError(
          createError({
            type: "agent",
            message: `Unknown method: ${method}`,
          }),
        );
    }
  }

  private initialize(params: JSONRPCParams | undefined): Promise<Record<string, unknown>> {
    const p = toParamsRecord(params);
    const requested = typeof p.protocolVersion === "string" ? p.protocolVersion : undefined;
    const negotiated = requested && MCP_SUPPORTED_VERSIONS.includes(requested)
      ? requested
      : MCP_SUPPORTED_VERSIONS[0];

    const clientCaps = (p.capabilities ?? {}) as Record<string, unknown>;
    this.clientCapabilities = clientCaps;

    return Promise.resolve({
      protocolVersion: negotiated,
      serverInfo: {
        name: "veryfront-mcp",
        title: "Veryfront MCP Server",
        version: VERSION,
        description:
          "Veryfront development server tools for real-time errors, route preview, HMR control, and scaffolding",
      },
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
        completions: {},
        logging: {},
        tasks: { list: {}, cancel: {}, requests: { tools: { call: {} } } },
      },
      instructions:
        "Veryfront MCP server provides development tools. Use vf_get_errors to check for code errors, vf_get_logs for server logs, vf_scaffold for code generation, and vf_get_project_context for project structure.",
    });
  }

  private async listTools(_params?: JSONRPCParams): Promise<{ tools: ToolListEntry[] }> {
    const registry = getMCPRegistry();
    const tools: ToolListEntry[] = [];

    for (const [id, tool] of registry.tools.entries()) {
      if (tool.mcp?.enabled === false) continue;
      // Agent-owned tools are never listed to MCP clients: external callers
      // have no agent identity, so owned capabilities are invisible here
      // (and rejected at execution time by the registry executor).
      if (tool.ownerAgentId !== undefined) continue;

      const entry: ToolListEntry = {
        name: id,
        description: tool.description,
        inputSchema: tool.inputSchemaJson ?? zodToJsonSchema(tool.inputSchema),
      };
      if (tool.mcp?.title) entry.title = tool.mcp.title;
      if (tool.mcp?.annotations) entry.annotations = tool.mcp.annotations;
      tools.push(entry);
    }

    return { tools };
  }

  private callTool(
    params: JSONRPCParams | undefined,
    context?: ToolExecutionContext,
    requestId?: string | number,
    sessionId?: string,
  ): Promise<Record<string, unknown>> {
    const p = toParamsRecord(params);
    const { name, arguments: args } = p;
    const meta = (p._meta ?? {}) as Record<string, unknown>;
    const rawToken = meta.progressToken;
    const progressToken = (typeof rawToken === "string" || typeof rawToken === "number")
      ? rawToken
      : undefined;

    if (!name) {
      throw toError(createError({ type: "agent", message: "Tool name is required" }));
    }

    const toolName = String(name);

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

    if (tool.inputSchema && typeof tool.inputSchema.parse === "function") {
      try {
        tool.inputSchema.parse(args ?? {});
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new JsonRpcError(-32602, `Invalid arguments for tool ${toolName}: ${message}`);
      }
    }

    const toolContext: ToolExecutionContext | undefined = progressToken !== undefined
      ? { ...context, progressToken }
      : context;

    // Async task mode: if the caller provides a `task` field, create a task
    // and run the tool in the background, returning the task immediately.
    const taskParam = p.task as { ttl?: number } | undefined;
    if (taskParam) {
      const MIN_TTL = 1000;
      const MAX_TTL = 3_600_000; // 1 hour
      const rawTtl = typeof taskParam.ttl === "number" ? taskParam.ttl : 60000;
      const ttl = Math.max(MIN_TTL, Math.min(MAX_TTL, rawTtl));
      const task = this.taskStore.create(ttl);
      const abortController = new AbortController();
      const outerAbortSignal = toolContext?.abortSignal;
      const abortFromOuterSignal = () => abortController.abort();
      if (outerAbortSignal?.aborted) {
        abortController.abort();
      } else {
        outerAbortSignal?.addEventListener("abort", abortFromOuterSignal, { once: true });
      }
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
            this.taskStore.complete(task.taskId, {
              content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
              isError: false,
            });
          } catch (error) {
            if (this.taskStore.get(task.taskId)?.status === "cancelled") {
              return;
            }
            const message = error instanceof Error ? error.message : String(error);
            logger.warn("Async tool execution failed", {
              tool: toolName,
              taskId: task.taskId,
              error: message,
            });
            this.taskStore.fail(task.taskId, message);
          }
        },
        { "mcp.tool.name": toolName, "mcp.task.id": task.taskId },
      ).finally(() => {
        outerAbortSignal?.removeEventListener("abort", abortFromOuterSignal);
        this.pendingTasks.delete(task.taskId);
      });
      this.pendingTasks.set(task.taskId, { promise: pending, abortController });

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
              return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
                isError: false,
              };
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              return {
                content: [{ type: "text", text: message }],
                isError: true,
              };
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
    const abortFromOuterSignal = () => abortController?.abort();
    const requestKey = requestId === undefined
      ? undefined
      : pendingRequestKey(requestId, sessionId);

    if (abortController) {
      if (outerAbortSignal?.aborted) {
        abortController.abort();
      } else {
        outerAbortSignal?.addEventListener("abort", abortFromOuterSignal, { once: true });
      }
      this.pendingRequestAbortControllers.set(requestKey!, abortController);
    }

    try {
      return await operation(abortController?.signal ?? outerAbortSignal);
    } finally {
      if (
        requestKey !== undefined &&
        this.pendingRequestAbortControllers.get(requestKey) === abortController
      ) {
        this.pendingRequestAbortControllers.delete(requestKey);
      }
      outerAbortSignal?.removeEventListener("abort", abortFromOuterSignal);
    }
  }

  private listResourceTemplates(
    _params?: JSONRPCParams,
  ): Promise<{ resourceTemplates: Array<Record<string, unknown>> }> {
    const registry = getMCPRegistry();
    const templates: Array<Record<string, unknown>> = [];

    for (const [id, resource] of registry.resources.entries()) {
      if (resource.mcp?.enabled === false) continue;
      if (resourceRegistry.isTemplatePattern(resource.pattern)) {
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
    }

    return Promise.resolve({ resourceTemplates: templates });
  }

  private listResources(
    _params?: JSONRPCParams,
  ): Promise<{ resources: Array<Record<string, unknown>> }> {
    const registry = getMCPRegistry();
    const resources: Array<Record<string, unknown>> = [];

    for (const [id, resource] of registry.resources.entries()) {
      if (
        resource.mcp?.enabled === false ||
        resourceRegistry.isTemplatePattern(resource.pattern)
      ) {
        continue;
      }
      const entry: Record<string, unknown> = {
        uri: resource.pattern,
        name: id,
        description: resource.description,
        mimeType: getResourceMCPMimeType(resource),
      };
      if (resource.title) entry.title = resource.title;
      resources.push(entry);
    }

    return Promise.resolve({ resources });
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
          },
        ),
      {
        "mcp.resource.id": resourceId,
        "mcp.resource.pattern": resource.pattern,
      },
    );
  }

  private listPrompts(
    _params?: JSONRPCParams,
  ): Promise<{ prompts: Array<Record<string, unknown>> }> {
    const registry = getMCPRegistry();
    const prompts: Array<Record<string, unknown>> = [];

    for (const [id, promptInstance] of registry.prompts.entries()) {
      if (promptInstance.mcp?.enabled === false) continue;

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

    return Promise.resolve({ prompts });
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

  private complete(
    _params: JSONRPCParams | undefined,
  ): Promise<{ completion: { values: string[]; total?: number; hasMore: boolean } }> {
    // Stub: returns empty completions for all refs.
    // Real logic will resolve values from resource templates and prompts.
    return Promise.resolve({
      completion: { values: [], total: 0, hasMore: false },
    });
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

  private cancelRequest(
    params: JSONRPCParams | undefined,
    sessionId?: string,
  ): Promise<Record<string, unknown>> {
    const { requestId } = toParamsRecord(params);
    if (typeof requestId !== "string" && typeof requestId !== "number") {
      return Promise.resolve({});
    }

    this.pendingRequestAbortControllers.get(pendingRequestKey(requestId, sessionId))?.abort();
    return Promise.resolve({});
  }

  private getTask(params: JSONRPCParams | undefined): Promise<Record<string, unknown>> {
    const { taskId } = toParamsRecord(params);
    if (!taskId) {
      throw new JsonRpcError(-32602, "taskId is required");
    }
    const task = this.taskStore.get(String(taskId));
    if (!task) {
      throw new JsonRpcError(-32602, `Task not found: ${taskId}`);
    }
    return Promise.resolve({ ...task });
  }

  private getTaskResult(params: JSONRPCParams | undefined): Promise<Record<string, unknown>> {
    const { taskId } = toParamsRecord(params);
    if (!taskId) {
      throw new JsonRpcError(-32602, "taskId is required");
    }
    const task = this.taskStore.get(String(taskId));
    if (!task) {
      throw new JsonRpcError(-32602, `Task not found: ${taskId}`);
    }
    const result = this.taskStore.getResult(String(taskId));
    if (result === undefined) {
      throw new JsonRpcError(-32002, "Task result is not yet available");
    }
    return Promise.resolve(result as Record<string, unknown>);
  }

  private cancelTask(params: JSONRPCParams | undefined): Promise<Record<string, unknown>> {
    const { taskId } = toParamsRecord(params);
    if (!taskId) {
      throw new JsonRpcError(-32602, "taskId is required");
    }
    const id = String(taskId);
    const task = this.taskStore.get(id);
    if (!task || !this.taskStore.cancel(id)) {
      throw new JsonRpcError(-32002, `Cannot cancel task: ${taskId}`);
    }
    this.pendingTasks.get(id)?.abortController.abort();
    return Promise.resolve({ ...task });
  }

  private listTasks(): Promise<Record<string, unknown>> {
    return Promise.resolve({ tasks: this.taskStore.list() });
  }

  /** Wait for all background task executions to settle. Useful in tests. */
  waitForPendingTasks(): Promise<void> {
    return Promise.all(Array.from(this.pendingTasks.values(), (run) => run.promise)).then(() => {});
  }

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
      sessionManager: this.sessionManager,
    });
  }

  private extractRequestContext(request: Request): ToolExecutionContext | undefined {
    const context: ToolExecutionContext = {};

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

  private async validateAuth(request: Request): Promise<boolean> {
    const auth = this.config.auth;
    if (auth.type === "none") return true;

    const authHeader = request.headers.get("Authorization");
    if (!authHeader) return false;

    // Parse strictly: accept only "Bearer <token>" (scheme case-insensitive) and
    // reject other/no-scheme headers rather than passing a malformed value on.
    const bearerMatch = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
    if (!bearerMatch) return false;
    const token = (bearerMatch[1] ?? "").trim();
    if (!token) return false;

    // When bearer auth is configured without a validate function, reject all requests
    if (!auth.validate) {
      logger.warn("Bearer auth configured without validate function — rejecting request");
      return false;
    }

    return await auth.validate(token);
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
      "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Session-Id, X-Project-Id",
      "Vary": "Origin",
    };
  }
}

/** Create mcpserver. */
export function createMCPServer(config: MCPServerConfig): MCPServer {
  return new MCPServer(config);
}
