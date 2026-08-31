import { parseProviderError } from "../../chat/provider-errors.ts";
import { CONTROL_PLANE_RUN_STREAM_PATH } from "../../channels/control-plane.ts";
import type { AgentServiceRoute } from "./definition.ts";
import { createAgUiRunErrorEvent, createAgUiSseErrorResponse } from "../ag-ui/host-support.ts";
import { createAgUiRuntimeHandler } from "../ag-ui/runtime-handler.ts";
import { createAgUiCancelHandler } from "../ag-ui/run-control.ts";
import type { AgUiResumeValue } from "../ag-ui/tool-shared.ts";
import type { DetachedRunTracker } from "./detached-run-tracker.ts";
import {
  buildParsedHostedAgUiRequest,
  createHostedAgUiValidationErrorResponse,
  type ParsedHostedAgUiRequest,
} from "../hosted/ag-ui-chat-request.ts";
import {
  type ParsedHostedChatRequest,
  parseHostedChatRequestFromRequest,
  parseRuntimeAgentRunInvocationHostedChatRequestFromRequest,
} from "../hosted/chat-request-parser.ts";
import { executeHostedDurableChatRun } from "../hosted/durable-chat-run-start.ts";
import {
  type HostedServiceAuthenticatedRequest,
  HostedServiceAuthError,
  type HostedServiceRunEventAppendTokenVerification,
} from "./auth.ts";
import { createRequestAuthCache } from "./request-auth-cache.ts";
import { createApplicationRequest } from "#veryfront/security/http/application-request.ts";
import { isResponseLike } from "./response-like.ts";
import type { AgUiRuntimeRequest } from "../runtime/ag-ui-contract.ts";
import {
  type HostedRuntimeSourceIdentity,
  snapshotHostedRuntimeSourceIdentity,
} from "../hosted/runtime-source-binding.ts";
import { runWithHostedRequestPreparationSignal } from "./request-preparation-context.ts";
import {
  runWithVerifiedHostedRunEventWriterRequest,
} from "../hosted/child-run-event-writer-token.ts";

const IntrinsicReflectApply = Reflect.apply;
const RequestClone = Request.prototype.clone;
const RequestJson = Request.prototype.json;

/** Public API contract for hosted agent service routes logger. */
export type HostedAgentServiceRoutesLogger = {
  warn?: (message: string, metadata?: Record<string, unknown>) => void;
  error(message: string, metadata?: Record<string, unknown>): void;
};

/** Public API contract for agent service routes logger. */
export type AgentServiceRoutesLogger = HostedAgentServiceRoutesLogger;

/** Public API contract for hosted agent service routes trace. */
export type HostedAgentServiceRoutesTrace = <TResult>(
  operationName: string,
  operation: () => Promise<TResult>,
) => Promise<TResult>;

/** Public API contract for agent service routes trace. */
export type AgentServiceRoutesTrace = HostedAgentServiceRoutesTrace;

/** Public API contract for hosted agent service active span attributes. */
export type HostedAgentServiceActiveSpanAttributes = Record<
  string,
  string | number | boolean | readonly (string | number | boolean)[] | null | undefined
>;

/** Public API contract for agent service active span attributes. */
export type AgentServiceActiveSpanAttributes = HostedAgentServiceActiveSpanAttributes;

/** Input payload for hosted agent service stream execution. */
export type HostedAgentServiceStreamExecutionInput<TExecution extends object> = TExecution & {
  requestAbortSignal: AbortSignal;
  agUiInput: AgUiRuntimeRequest;
};

/** Input payload for agent service stream execution. */
export type AgentServiceStreamExecutionInput<TExecution extends object> =
  HostedAgentServiceStreamExecutionInput<TExecution>;

/** Input delivered to a hosted agent-service detached execution callback. */
export type HostedAgentServiceDetachedExecutionInput<TExecution extends object> = {
  execution: TExecution;
  abortSignal: AbortSignal;
  /** Required application-facing request clone with internal control headers removed. */
  rawRequest: Request;
};

/** Input payload for agent service detached execution. */
export type AgentServiceDetachedExecutionInput<TExecution extends object> =
  HostedAgentServiceDetachedExecutionInput<TExecution>;

/** Input payload for hosted agent service detached cleanup. */
export type HostedAgentServiceDetachedCleanupInput<TExecution extends object> = {
  execution: TExecution;
  runId: string;
  conversationId: string;
};

/** Input payload for agent service detached cleanup. */
export type AgentServiceDetachedCleanupInput<TExecution extends object> =
  HostedAgentServiceDetachedCleanupInput<TExecution>;

/** Options accepted by hosted agent service route set. */
export type HostedAgentServiceRouteSetOptions<TExecution extends object> = {
  forwardedConfigNamespace?: string;
  /** Exact immutable source snapshot served by control-plane runtime invocations. */
  runtimeSource?: HostedRuntimeSourceIdentity;
  authenticateRequest: (
    request: Request,
  ) => Promise<HostedServiceAuthenticatedRequest | Response>;
  verifyProjectAccess: (projectId: string, authToken: string) => Promise<
    {
      success: true;
      projectSlug?: string;
    } | {
      success: false;
      error: { errorCode: string; message: string; statusCode: number };
    }
  >;
  verifyRunEventAppendToken?: (input: {
    token: string;
    projectId: string;
    runId: string;
  }) => Promise<HostedServiceRunEventAppendTokenVerification>;
  tracker: DetachedRunTracker<AgUiResumeValue>;
  prepareExecution: (req: ParsedHostedChatRequest) => Promise<TExecution>;
  streamExecutionToAgUiResponse: (
    input: HostedAgentServiceStreamExecutionInput<TExecution>,
  ) => Promise<Response> | Response;
  startDetachedExecution: (
    input: HostedAgentServiceDetachedExecutionInput<TExecution>,
  ) => Promise<void>;
  cleanupExecution?: (
    input: HostedAgentServiceDetachedCleanupInput<TExecution>,
  ) => Promise<void>;
  setActiveSpanAttributes?: (attributes: HostedAgentServiceActiveSpanAttributes) => void;
  trace?: HostedAgentServiceRoutesTrace;
  logger?: HostedAgentServiceRoutesLogger;
};

export type AgentServiceRouteSetOptions<TExecution extends object> =
  HostedAgentServiceRouteSetOptions<TExecution>;

/** Public API contract for hosted agent service route set. */
export type HostedAgentServiceRouteSet<TExecution extends object> = {
  routes: AgentServiceRoute[];
  authenticateAgUiRequest: (
    request: Request,
  ) => Promise<HostedServiceAuthenticatedRequest | Response>;
  createAgUiValidationErrorResponse: (response: Response) => Promise<Response>;
  buildParsedAgUiRequest: (input: {
    agUiInput: AgUiRuntimeRequest;
    authToken: string;
    userId: string;
  }) => Promise<ParsedHostedAgUiRequest | Response>;
  handleAgUiRequest: (request: Request) => Promise<Response>;
  handleDurableChatRunExecuteRequest: (input: {
    request: Request;
    requestOrCtx?: unknown;
  }) => Promise<Response>;
  handleRuntimeAgentRunInvocationExecuteRequest: (input: {
    request: Request;
    requestOrCtx?: unknown;
    runId?: string;
  }) => Promise<Response>;
  handleDurableChatRunCancelRequest: (input: {
    request: Request;
    runId: string | undefined;
  }) => Promise<Response>;
};

export type AgentServiceRouteSet<TExecution extends object> = HostedAgentServiceRouteSet<
  TExecution
>;

function defaultTrace<TResult>(
  _operationName: string,
  operation: () => Promise<TResult>,
): Promise<TResult> {
  return operation();
}

async function createRuntimeInvocationApplicationRequest(request: Request): Promise<Request> {
  // The hosted parser consumes the original request body for authentication. The
  // retained clone must therefore be materialized and sanitized separately before
  // the detached callback receives an application-facing request.
  const payload = await IntrinsicReflectApply(RequestJson, request, []) as Record<string, unknown>;
  const credentials = payload.credentials;
  const sanitizedPayload = credentials && typeof credentials === "object" &&
      !Array.isArray(credentials)
    ? {
      ...payload,
      credentials: Object.fromEntries(
        Object.entries(credentials).filter(([key]) => key !== "inferenceAuthToken"),
      ),
    }
    : payload;
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  return createApplicationRequest(
    new Request(request.url, {
      body: JSON.stringify(sanitizedPayload),
      headers,
      method: request.method,
      signal: request.signal,
    }),
  );
}

function createAgUiSetupErrorResponse(input: {
  error: unknown;
  projectId: string | null;
  userId: string;
  runId: string | undefined;
  logger?: HostedAgentServiceRoutesLogger;
}): Response {
  if (input.error instanceof HostedServiceAuthError) {
    input.logger?.error("AG-UI auth error from API", {
      errorCode: input.error.errorCode,
      statusCode: input.error.statusCode,
      projectId: input.projectId,
      userId: input.userId,
      runId: input.runId,
    });
    return createAgUiSseErrorResponse(
      createAgUiRunErrorEvent(input.error.errorCode, input.error.errorCode),
      input.error.statusCode,
    );
  }

  const { code, status, message } = parseProviderError(input.error);
  input.logger?.error("AG-UI request failed during setup", {
    errorCode: code,
    originalError: input.error instanceof Error ? input.error.message : String(input.error),
    projectId: input.projectId,
    userId: input.userId,
    runId: input.runId,
  });

  const statusCode = status ||
    (code === "OVERLOADED_ERROR" ? 503 : code === "CONTEXT_LENGTH_EXCEEDED" ? 413 : 500);
  return createAgUiSseErrorResponse(createAgUiRunErrorEvent(message, code), statusCode);
}

/** Create hosted agent service route set. */
export function createHostedAgentServiceRouteSet<TExecution extends object>(
  options: HostedAgentServiceRouteSetOptions<TExecution>,
): HostedAgentServiceRouteSet<TExecution> {
  const trace = options.trace ?? defaultTrace;
  const forwardedConfigNamespace = options.forwardedConfigNamespace ?? "veryfront";
  const runtimeSource = options.runtimeSource
    ? snapshotHostedRuntimeSourceIdentity(options.runtimeSource)
    : undefined;
  const requestAuthCache = createRequestAuthCache<HostedServiceAuthenticatedRequest>({
    authenticate: (request) => trace("agui.verifyJwt", () => options.authenticateRequest(request)),
  });

  async function authenticateAgUiRequest(
    request: Request,
  ): Promise<HostedServiceAuthenticatedRequest | Response> {
    return requestAuthCache.authenticate(request);
  }

  async function buildParsedAgUiRequest(input: {
    agUiInput: AgUiRuntimeRequest;
    authToken: string;
    userId: string;
  }): Promise<ParsedHostedAgUiRequest | Response> {
    return buildParsedHostedAgUiRequest({
      ...input,
      forwardedConfigNamespace,
      verifyProjectAccess: ({ projectId, authToken }) =>
        options.verifyProjectAccess(projectId, authToken),
    });
  }

  async function executeAgUiRuntimeRequest(input: {
    request: Request;
    agUiInput: AgUiRuntimeRequest;
  }): Promise<Response> {
    const authenticatedRequest = await authenticateAgUiRequest(input.request);
    if (isResponseLike(authenticatedRequest)) {
      return authenticatedRequest;
    }

    const parsedRequest = await buildParsedAgUiRequest({
      agUiInput: input.agUiInput,
      authToken: authenticatedRequest.authToken,
      userId: authenticatedRequest.userId,
    });
    if (isResponseLike(parsedRequest)) {
      return parsedRequest;
    }
    const runId = parsedRequest.agUiInput?.runId;

    try {
      const execution = await runWithHostedRequestPreparationSignal(
        input.request.signal,
        () => options.prepareExecution(parsedRequest),
      );
      return await options.streamExecutionToAgUiResponse({
        ...execution,
        requestAbortSignal: input.request.signal,
        agUiInput: parsedRequest.agUiInput,
      });
    } catch (error) {
      return createAgUiSetupErrorResponse({
        error,
        projectId: parsedRequest.projectId,
        userId: parsedRequest.userId,
        runId,
        logger: options.logger,
      });
    }
  }

  const hostedAgUiRuntimeHandler = createAgUiRuntimeHandler({
    beforeParse: async ({ applicationRequest }) => {
      const result = await authenticateAgUiRequest(applicationRequest);
      return isResponseLike(result) ? result : undefined;
    },
    validationErrorResponse: ({ response }) => createHostedAgUiValidationErrorResponse(response),
    execute: ({ request, agUiInput }) => executeAgUiRuntimeRequest({ request, agUiInput }),
  });

  async function handleAgUiRequest(request: Request): Promise<Response> {
    return hostedAgUiRuntimeHandler(request);
  }

  async function executeParsedDurableChatRun(input: {
    req: ParsedHostedChatRequest;
    request: Request;
    requestOrCtx?: unknown;
  }): Promise<Response> {
    const requestOrCtx = input.requestOrCtx instanceof Request ? input.request : input.requestOrCtx;
    return executeHostedDurableChatRun({
      req: input.req,
      rawRequest: input.request,
      requestOrCtx,
      tracker: options.tracker,
      prepareExecution: (request) =>
        runWithHostedRequestPreparationSignal(
          input.request.signal,
          () =>
            runWithVerifiedHostedRunEventWriterRequest(
              input.req,
              () => options.prepareExecution(request),
            ),
        ),
      startDetachedExecution: options.startDetachedExecution,
      cleanupExecution: options.cleanupExecution,
      resolveAuthError: (error) =>
        error instanceof HostedServiceAuthError
          ? {
            errorCode: error.errorCode,
            statusCode: error.statusCode,
          }
          : null,
      logger: options.logger,
    });
  }

  async function handleDurableChatRunExecuteRequest(input: {
    request: Request;
    requestOrCtx?: unknown;
  }): Promise<Response> {
    return trace("handler.durableChatRunExecute", async () => {
      const applicationRequest = createApplicationRequest(input.request);
      const req = await parseHostedChatRequestFromRequest(input.request, {
        authenticate: options.authenticateRequest,
        verifyProjectAccess: ({ projectId, authToken }) =>
          options.verifyProjectAccess(projectId, authToken),
        verifyRunEventAppendToken: options.verifyRunEventAppendToken,
      });
      if (req instanceof Response) {
        return req;
      }

      return executeParsedDurableChatRun({
        req,
        request: applicationRequest,
        requestOrCtx: input.requestOrCtx,
      });
    });
  }

  async function handleRuntimeAgentRunInvocationExecuteRequest(input: {
    request: Request;
    requestOrCtx?: unknown;
    runId?: string;
  }): Promise<Response> {
    return trace("handler.runtimeAgentRunInvocationExecute", async () => {
      const applicationRequestSource = IntrinsicReflectApply(
        RequestClone,
        input.request,
        [],
      ) as Request;
      const req = await parseRuntimeAgentRunInvocationHostedChatRequestFromRequest(input.request, {
        authenticate: options.authenticateRequest,
        verifyProjectAccess: ({ projectId, authToken }) =>
          options.verifyProjectAccess(projectId, authToken),
        verifyRunEventAppendToken: options.verifyRunEventAppendToken,
        runtimeSource,
      });
      if (req instanceof Response) {
        return req;
      }

      if (input.runId && req.durableRootRun?.runId !== input.runId) {
        return Response.json({ errorCode: "CONTROL_PLANE_RUN_ID_MISMATCH" }, { status: 400 });
      }

      const applicationRequest = await createRuntimeInvocationApplicationRequest(
        applicationRequestSource,
      );

      return executeParsedDurableChatRun({
        req,
        request: applicationRequest,
        requestOrCtx: input.requestOrCtx,
      });
    });
  }

  async function handleDurableChatRunCancelRequest(input: {
    request: Request;
    runId: string | undefined;
  }): Promise<Response> {
    return trace("handler.durableChatRunCancel", async () => {
      const authenticatedRequest = await authenticateAgUiRequest(input.request);
      if (authenticatedRequest instanceof Response) {
        return authenticatedRequest;
      }

      if (!input.runId) {
        return Response.json({ errorCode: "VALIDATION_ERROR" }, { status: 400 });
      }

      options.setActiveSpanAttributes?.({ "run.id": input.runId });
      const hostedAgUiCancelHandler = createAgUiCancelHandler({
        sessionManager: options.tracker.sessionManager,
      });
      return hostedAgUiCancelHandler(input.request);
    });
  }

  const routes: AgentServiceRoute[] = [
    {
      method: "POST",
      path: "/api/ag-ui",
      handler: (request: Request) => handleAgUiRequest(request),
    },
    {
      method: "DELETE",
      path: "/api/runs/:runId",
      handler: (request: Request, params: Record<string, string>) =>
        handleDurableChatRunCancelRequest({
          request,
          runId: params.runId,
        }),
    },
    {
      method: "POST",
      path: "/api/runs",
      handler: (request: Request) => handleDurableChatRunExecuteRequest({ request }),
    },
    {
      method: "POST",
      path: CONTROL_PLANE_RUN_STREAM_PATH,
      handler: (request: Request, params: Record<string, string>) =>
        handleRuntimeAgentRunInvocationExecuteRequest({ request, runId: params.runId }),
    },
  ];

  return {
    routes,
    authenticateAgUiRequest,
    createAgUiValidationErrorResponse: createHostedAgUiValidationErrorResponse,
    buildParsedAgUiRequest,
    handleAgUiRequest,
    handleDurableChatRunExecuteRequest,
    handleRuntimeAgentRunInvocationExecuteRequest,
    handleDurableChatRunCancelRequest,
  };
}

export const createAgentServiceRouteSet = createHostedAgentServiceRouteSet;
