import { parseProviderError } from "../../chat/provider-errors.ts";
import { compactHistoricalUiMessageToolInputs } from "../../chat/message-prep.ts";
import type { ChatUiMessage } from "../../chat/types.ts";
import {
  AgUiDetachedStartAcceptedSchema,
  buildDetachedAgUiStartRequest,
  executeAgUiDetachedStart,
} from "../ag-ui/detached-start.ts";
import type { AgUiResumeValue } from "../ag-ui/tool-shared.ts";
import type { DetachedRunTracker } from "../service/detached-run-tracker.ts";
import type { ParsedHostedChatRequest } from "./chat-request-parser.ts";

/** Public API contract for hosted durable run setup error status code. */
export type HostedDurableRunSetupErrorStatusCode = 400 | 402 | 413 | 429 | 500 | 503;

/** Public API contract for hosted durable run accepted. */
export type HostedDurableRunAccepted = {
  accepted: boolean;
  duplicate: boolean;
};

/** Response payload for hosted durable run auth error. */
export type HostedDurableRunAuthErrorResponse = {
  errorCode: string;
  statusCode: number;
  metadata?: Record<string, unknown>;
};

/** Public API contract for hosted durable run logger. */
export type HostedDurableRunLogger = {
  error(message: string, metadata?: Record<string, unknown>): void;
};

/** Input payload for hosted durable run start execution. */
export type HostedDurableRunStartExecutionInput<TExecution> = {
  execution: TExecution;
  abortSignal: AbortSignal;
};

/** Input payload for hosted durable run start cleanup. */
export type HostedDurableRunStartCleanupInput<TExecution> = {
  execution: TExecution;
  runId: string;
  conversationId: string;
};

/** Input payload for execute hosted durable chat run. */
export type ExecuteHostedDurableChatRunInput<TExecution> = {
  req: ParsedHostedChatRequest;
  rawRequest: Request;
  requestOrCtx?: unknown;
  tracker: DetachedRunTracker<AgUiResumeValue>;
  prepareExecution: (req: ParsedHostedChatRequest) => Promise<TExecution>;
  startDetachedExecution: (
    input: HostedDurableRunStartExecutionInput<TExecution>,
  ) => Promise<void>;
  cleanupExecution?: (input: HostedDurableRunStartCleanupInput<TExecution>) => Promise<void>;
  resolveAuthError?: (error: unknown) => HostedDurableRunAuthErrorResponse | null | undefined;
  logger?: HostedDurableRunLogger;
};

function readBooleanProperty(input: object | null, propertyName: string): boolean {
  if (!input) {
    return false;
  }

  return Object.getOwnPropertyDescriptor(input, propertyName)?.value === true;
}

function isDurableRunSetupErrorStatusCode(
  status: number | undefined,
): status is HostedDurableRunSetupErrorStatusCode {
  return status === 400 || status === 402 || status === 413 || status === 429 ||
    status === 500 || status === 503;
}

function fallbackDurableRunSetupErrorStatusCode(
  code: string,
): HostedDurableRunSetupErrorStatusCode {
  if (code === "OVERLOADED_ERROR") return 503;
  if (code === "CONTEXT_LENGTH_EXCEEDED") return 413;

  return 500;
}

/** Response payload for resolve hosted durable run setup error. */
export function resolveHostedDurableRunSetupErrorResponse(input: {
  code: string;
  status?: number;
  originalError: unknown;
}): {
  errorCode: string;
  statusCode: HostedDurableRunSetupErrorStatusCode;
} {
  if (
    input.originalError instanceof Error &&
    input.originalError.message === "DURABLE_CHAT_ROOT_REQUIRES_CONVERSATION"
  ) {
    return {
      errorCode: "DURABLE_CHAT_ROOT_REQUIRES_CONVERSATION",
      statusCode: 400,
    };
  }

  return {
    errorCode: input.code,
    statusCode: isDurableRunSetupErrorStatusCode(input.status)
      ? input.status
      : fallbackDurableRunSetupErrorStatusCode(input.code),
  };
}

async function parseAcceptedDetachedStartResponse(
  response: Response,
): Promise<HostedDurableRunAccepted> {
  if (response.status !== 202) {
    return { accepted: false, duplicate: false };
  }

  const payload = await response.json().catch((): null => null);
  const parsed = AgUiDetachedStartAcceptedSchema.safeParse(payload);
  if (parsed.success) {
    return {
      accepted: parsed.data.accepted,
      duplicate: parsed.data.duplicate,
    };
  }

  const payloadObject = typeof payload === "object" ? payload : null;
  return {
    accepted: readBooleanProperty(payloadObject, "accepted"),
    duplicate: readBooleanProperty(payloadObject, "duplicate"),
  };
}

/** Prepare durable detached-start messages without carrying completed large historical tool inputs. */
export function prepareDetachedStartMessages(messages: ChatUiMessage[]): ChatUiMessage[] {
  return compactHistoricalUiMessageToolInputs(messages);
}

async function executeHostedDurableChatRunStart<TExecution>(
  input: ExecuteHostedDurableChatRunInput<TExecution>,
): Promise<Response | HostedDurableRunAccepted> {
  const { durableRootRun, conversationId } = input.req;
  if (!durableRootRun || !conversationId) {
    throw new Error("DURABLE_CHAT_ROOT_REQUIRES_CONVERSATION");
  }

  const execution = await input.prepareExecution(input.req);
  const detachedStartRequest = buildDetachedAgUiStartRequest({
    runId: durableRootRun.runId,
    threadId: conversationId,
    messages: prepareDetachedStartMessages(input.req.messages),
    model: input.req.model,
    forwardedProps: input.req.forwardedProps,
  });
  const detachedStartResponse = await executeAgUiDetachedStart(
    {
      sessionManager: input.tracker.sessionManager,
      startDetachedExecution: async ({ abortSignal }) => {
        const detachedExecution = input.startDetachedExecution({
          execution,
          abortSignal,
        });
        input.tracker.registerExecution(durableRootRun.runId, detachedExecution);
        await detachedExecution;
      },
      onDuplicate: async () => {
        await input.cleanupExecution?.({
          execution,
          runId: durableRootRun.runId,
          conversationId,
        });
      },
      onAccepted: async () => {
        input.tracker.trackRun(durableRootRun.runId);
      },
      onError: async ({ error }) => {
        input.tracker.untrackRun(durableRootRun.runId);
        input.logger?.error("Detached durable run execution failed", {
          runId: durableRootRun.runId,
          conversationId,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    },
    {
      request: detachedStartRequest,
      rawRequest: input.rawRequest,
      requestOrCtx: input.requestOrCtx ?? input.rawRequest,
    },
  );

  if (detachedStartResponse.status !== 202) {
    return detachedStartResponse;
  }

  return await parseAcceptedDetachedStartResponse(detachedStartResponse);
}

/** Execute hosted durable chat run. */
export async function executeHostedDurableChatRun<TExecution>(
  input: ExecuteHostedDurableChatRunInput<TExecution>,
): Promise<Response> {
  const { durableRootRun, conversationId, projectId, userId } = input.req;
  if (!durableRootRun || !conversationId) {
    return Response.json(
      { errorCode: "DURABLE_CHAT_ROOT_REQUIRES_CONVERSATION" },
      { status: 400 },
    );
  }

  const existingRunStatus = input.tracker.sessionManager.getRunStatus(durableRootRun.runId);
  if (existingRunStatus === "running" || existingRunStatus === "waiting") {
    return Response.json({ accepted: true, duplicate: true }, { status: 202 });
  }

  try {
    const startResult = await executeHostedDurableChatRunStart(input);

    if (startResult instanceof Response) {
      return startResult;
    }

    return Response.json(startResult, { status: 202 });
  } catch (error) {
    const authError = input.resolveAuthError?.(error);
    if (authError) {
      input.logger?.error("Durable chat auth error from API", {
        errorCode: authError.errorCode,
        statusCode: authError.statusCode,
        projectId,
        userId,
        runId: durableRootRun.runId,
        ...authError.metadata,
      });
      return Response.json(
        { errorCode: authError.errorCode },
        { status: authError.statusCode },
      );
    }

    const { code, status } = parseProviderError(error);
    const response = resolveHostedDurableRunSetupErrorResponse({
      code,
      status,
      originalError: error,
    });
    input.logger?.error("Durable chat execute failed during setup", {
      errorCode: code,
      originalError: error instanceof Error ? error.message : String(error),
      projectId,
      userId,
      runId: durableRootRun.runId,
    });

    return Response.json(
      { errorCode: response.errorCode },
      { status: response.statusCode },
    );
  }
}
