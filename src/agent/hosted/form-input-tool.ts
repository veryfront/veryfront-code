import { tool, type ToolExecutionContext } from "#veryfront/tool";
import { containsExactArtifactPathValue } from "../artifacts/slash-command-artifact-policy.ts";
import type { ChatUiMessage, ChatUiMessagePart } from "../../chat/types.ts";
import type { HostedSubmittedFormInputResult } from "./chat-runtime-contract.ts";
import {
  buildInputRequestLifecycleDataEvent,
  createInputRequest,
  type FormInputToolInput,
  getFormInputToolInputSchema,
  getInputRequest,
  type InputRequestOutput,
} from "../input/request-protocol.ts";
import { executeDurableHumanInputFlow, type HumanInputResult } from "../input/human-input.ts";

const INPUT_REQUEST_TIMEOUT_MS = 5 * 60_000;
const INPUT_REQUEST_POLL_INTERVAL_MS = 500;

type PersistedFormInputToolPart = ChatUiMessagePart & {
  toolCallId: string;
  output: unknown;
};

/** Context for hosted form input tool. */
export interface HostedFormInputToolContext {
  authToken: string;
  conversationId?: string;
  parentRunId?: string;
  slashCommandArtifactPathSeen?: boolean;
  submittedFormInputResult?: HostedSubmittedFormInputResult;
}

/** Create hosted form input tool. */
export function createHostedFormInputTool(context: HostedFormInputToolContext, apiUrl: string) {
  return tool<FormInputToolInput, unknown>({
    description:
      "Display a durable structured form to collect user input. Use this when you need a concrete choice or structured values before continuing. The request is persisted as an input_request and the tool waits until the user submits or the request expires.",
    inputSchema: getFormInputToolInputSchema(),
    execute: async (input, execOptions) =>
      executeDurableFormInputFlow(context, apiUrl, input, execOptions),
  });
}

async function executeDurableFormInputFlow(
  context: HostedFormInputToolContext,
  apiUrl: string,
  input: FormInputToolInput,
  execContext?: ToolExecutionContext,
) {
  if (!context.conversationId) {
    throw new Error("form_input requires a durable conversation context");
  }
  if (!context.parentRunId) {
    throw new Error("form_input requires a durable run context");
  }

  const conversationId = context.conversationId;
  const parentRunId = context.parentRunId;
  if (context.submittedFormInputResult) {
    return {
      submitted: true,
      values: context.submittedFormInputResult.values,
      inputRequestId: context.submittedFormInputResult.inputRequestId,
      reused: true,
      reason:
        "A submitted form_input result already exists for this run. Use these values as final input, do not call form_input again, and continue to the requested output.",
    };
  }

  const toolCallId =
    typeof execContext?.toolCallId === "string" && execContext.toolCallId.length > 0
      ? execContext.toolCallId
      : `form_input-${crypto.randomUUID()}`;

  // Explicitly type the executeDurableHumanInputFlow generics so
  // `created`/`createdRequest`/`current` are correctly typed downstream.
  // (The contract DSL erases callback parameter types through .transform, so
  // we annotate at the boundary to keep inference flowing.)
  const { result, createdRequest } = await executeDurableHumanInputFlow<
    InputRequestOutput,
    InputRequestOutput
  >({
    runId: parentRunId,
    threadId: conversationId,
    toolCallId,
    // FormInputToolInput omits `metadata`; spread it explicitly as undefined to
    // satisfy the contract DSL's strict object shape (optional fields are
    // typed as required-key, undefined-or-T value).
    request: { ...input, metadata: undefined },
    timeoutMs: INPUT_REQUEST_TIMEOUT_MS + 5_000,
    pollIntervalMs: INPUT_REQUEST_POLL_INTERVAL_MS,
    onRequest: async (pendingRequest) => {
      const created = await createInputRequest({
        authToken: context.authToken,
        apiUrl,
        conversationId,
        runId: parentRunId,
        toolCallId,
        form: pendingRequest.request,
        expiresAt: new Date(Date.now() + INPUT_REQUEST_TIMEOUT_MS).toISOString(),
      });
      await execContext?.publishDataEvent?.(buildInputRequestLifecycleDataEvent({
        action: "created",
        inputRequest: created,
      }));
      return created;
    },
    getSnapshot: (created) =>
      getInputRequest({
        authToken: context.authToken,
        apiUrl,
        conversationId,
        inputRequestId: created.id,
      }),
    resolveSnapshot: (current) => resolveDurableInputRequestResult(context, current),
  });

  return {
    ...result,
    inputRequestId: createdRequest.id,
  };
}

function resolveDurableInputRequestResult(
  context: HostedFormInputToolContext,
  snapshot: InputRequestOutput,
): HumanInputResult | undefined {
  if (snapshot.status === "submitted") {
    const values = snapshot.latestResponse?.values ?? {};

    if (containsExactArtifactPathValue(values)) {
      context.slashCommandArtifactPathSeen = true;
    }
    context.submittedFormInputResult = {
      values,
      inputRequestId: snapshot.id,
    };

    return {
      submitted: true,
      values,
    };
  }

  if (snapshot.status === "cancelled" || snapshot.status === "expired") {
    return {
      submitted: false,
      values: {},
    };
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFormInputToolPart(part: ChatUiMessagePart): part is PersistedFormInputToolPart {
  if (!isRecord(part)) {
    return false;
  }
  const record = part as Record<string, unknown>;
  if (typeof record.toolCallId !== "string" || !("output" in record)) {
    return false;
  }
  const toolName = typeof record.toolName === "string" ? record.toolName : undefined;

  return toolName === "form_input" || part.type === "tool-form_input";
}

function extractSubmittedFormInputResult(
  part: ChatUiMessagePart,
): HostedSubmittedFormInputResult | undefined {
  if (!isFormInputToolPart(part) || !isRecord(part.output)) {
    return undefined;
  }
  if (part.output.submitted !== true || !isRecord(part.output.values)) {
    return undefined;
  }

  const inputRequestId = typeof part.output.inputRequestId === "string" &&
      part.output.inputRequestId.length > 0
    ? part.output.inputRequestId
    : part.toolCallId;

  return {
    values: part.output.values,
    inputRequestId,
  };
}

function latestUserMessageIndex(messages: readonly ChatUiMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.role === "user") {
      return index;
    }
  }

  return -1;
}

/** Find the latest submitted form_input result persisted after the latest user message. */
export function findSubmittedFormInputResult(
  messages: readonly ChatUiMessage[],
): HostedSubmittedFormInputResult | undefined {
  let result: HostedSubmittedFormInputResult | undefined;
  const startIndex = latestUserMessageIndex(messages) + 1;

  for (const message of messages.slice(startIndex)) {
    for (const part of message.parts) {
      result = extractSubmittedFormInputResult(part) ?? result;
    }
  }

  return result;
}
