import { tool, type ToolExecutionContext } from "#veryfront/tool";
import { containsExactArtifactPathValue } from "../slash-command-artifact-policy.ts";
import {
  buildInputRequestLifecycleDataEvent,
  createInputRequest,
  type FormInputToolInput,
  getFormInputToolInputSchema,
  getInputRequest,
  type InputRequestOutput,
} from "../input-request-protocol.ts";
import { executeDurableHumanInputFlow, type HumanInputResult } from "../human-input.ts";

const INPUT_REQUEST_TIMEOUT_MS = 5 * 60_000;
const INPUT_REQUEST_POLL_INTERVAL_MS = 500;

export interface HostedFormInputToolContext {
  authToken: string;
  conversationId?: string;
  parentRunId?: string;
  slashCommandArtifactPathSeen?: boolean;
}

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
