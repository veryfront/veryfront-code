import { z } from "zod";

const AGENT_RUN_API_TIMEOUT_MS = 15_000;

export const ConversationRunTargetsSchema = z.object({
  sourceTargetKind: z.enum(["project", "preview_branch"]).nullable(),
  runtimeTargetKind: z.enum(["production", "preview_branch"]).nullable(),
  targetBranchId: z.string().uuid().nullable(),
});

export type ConversationRunTargets = z.infer<typeof ConversationRunTargetsSchema>;

export function resolveConversationRunTargets(input: {
  projectId?: string | null;
  branchId?: string | null;
}): ConversationRunTargets {
  return ConversationRunTargetsSchema.parse(
    !input.projectId
      ? {
        sourceTargetKind: null,
        runtimeTargetKind: null,
        targetBranchId: null,
      }
      : input.branchId
      ? {
        sourceTargetKind: "preview_branch",
        runtimeTargetKind: "preview_branch",
        targetBranchId: input.branchId,
      }
      : {
        sourceTargetKind: "project",
        runtimeTargetKind: "production",
        targetBranchId: null,
      },
  );
}

export const ConversationRunProjectionSchema = z
  .object({
    runId: z.string().min(1).optional(),
    run_id: z.string().min(1).optional(),
    conversationId: z.string().uuid().optional(),
    conversation_id: z.string().uuid().optional(),
    messageId: z.string().uuid().optional(),
    message_id: z.string().uuid().optional(),
    latestEventId: z.number().int().nonnegative().optional(),
    latest_event_id: z.number().int().nonnegative().optional(),
    latestExternalEventSequence: z.number().int().nonnegative().optional(),
    latest_external_event_sequence: z.number().int().nonnegative().optional(),
    status: z.enum(["pending", "running", "waiting_for_tool", "completed", "failed", "cancelled"]),
  })
  .passthrough()
  .transform((data) => {
    const runId = data.runId ?? data.run_id;
    const conversationId = data.conversationId ?? data.conversation_id;
    const messageId = data.messageId ?? data.message_id;
    const latestEventId = data.latestEventId ?? data.latest_event_id ?? 0;
    const latestExternalEventSequence = data.latestExternalEventSequence ??
      data.latest_external_event_sequence;

    if (!runId || !conversationId || !messageId) {
      throw new Error("Missing run identifiers in durable run response");
    }

    if (latestExternalEventSequence === undefined) {
      throw new Error("Missing latestExternalEventSequence in durable run response");
    }

    return {
      runId,
      conversationId,
      messageId,
      latestEventId,
      latestExternalEventSequence,
      status: data.status,
    };
  });

export type ConversationRunProjection = z.infer<typeof ConversationRunProjectionSchema>;

export const CreateConversationRunAcceptedSchema = z
  .object({
    run: z
      .object({
        runId: z.string().min(1).optional(),
        run_id: z.string().min(1).optional(),
      })
      .passthrough(),
  })
  .passthrough()
  .transform((data) => {
    const runId = data.run.runId ?? data.run.run_id;
    if (!runId) {
      throw new Error("Missing run id in canonical create run response");
    }

    return { runId };
  });

export const CompleteConversationRunResponseSchema = z
  .object({
    completed: z.boolean(),
    run: z
      .object({
        runId: z.string().min(1).optional(),
        run_id: z.string().min(1).optional(),
        status: z.enum(["pending", "running", "waiting", "completed", "failed", "cancelled"]),
      })
      .passthrough(),
  })
  .passthrough();

export interface ConversationAgentRunUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface CreateConversationAgentRunInput {
  authToken: string;
  apiUrl: string;
  conversationId: string;
  runId?: string;
  agentId: string;
  projectId?: string | null;
  branchId?: string | null;
}

export interface FinalizeConversationAgentRunInput {
  authToken: string;
  apiUrl: string;
  conversationId: string;
  runId: string;
  status: "completed" | "failed" | "cancelled";
  model: string;
  provider: string;
  usage?: ConversationAgentRunUsage;
  terminalErrorCode?: string | null;
  terminalErrorMessage?: string | null;
}

async function controlPlaneJson<T>(input: {
  authToken: string;
  url: string;
  method?: "GET" | "POST";
  body?: unknown;
  responseSchema: z.ZodSchema<T>;
  operation: string;
}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, AGENT_RUN_API_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(input.url, {
      method: input.method ?? "GET",
      headers: {
        Authorization: `Bearer ${input.authToken}`,
        "Content-Type": "application/json",
      },
      ...(input.body !== undefined ? { body: JSON.stringify(input.body) } : {}),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`${input.operation} timed out after ${AGENT_RUN_API_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `${input.operation} failed (${response.status}): ${body || response.statusText}`,
    );
  }

  return input.responseSchema.parse(await response.json());
}

export async function createConversationAgentRun(
  input: CreateConversationAgentRunInput,
): Promise<ConversationRunProjection> {
  const targets = resolveConversationRunTargets({
    projectId: input.projectId ?? null,
    branchId: input.branchId ?? null,
  });
  const runId = input.runId ?? `run_${crypto.randomUUID()}`;

  await controlPlaneJson({
    authToken: input.authToken,
    url: `${input.apiUrl}/runs`,
    method: "POST",
    body: {
      kind: "agent",
      owner: {
        kind: "conversation",
        id: input.conversationId,
      },
      public_id: runId,
      request: {
        mode: "default_chat",
        agent_id: input.agentId,
        initial_status: "running",
        ...(targets.sourceTargetKind ? { source_target_kind: targets.sourceTargetKind } : {}),
        ...(targets.runtimeTargetKind ? { runtime_target_kind: targets.runtimeTargetKind } : {}),
        ...(targets.targetBranchId
          ? {
            source_target_branch_id: targets.targetBranchId,
            runtime_target_branch_id: targets.targetBranchId,
          }
          : {}),
      },
    },
    responseSchema: CreateConversationRunAcceptedSchema,
    operation: "Create canonical durable run",
  });

  return controlPlaneJson({
    authToken: input.authToken,
    url: `${input.apiUrl}/conversations/${input.conversationId}/runs/${runId}`,
    responseSchema: ConversationRunProjectionSchema,
    operation: "Read conversation durable run projection",
  });
}

export async function finalizeConversationAgentRun(
  input: FinalizeConversationAgentRunInput,
): Promise<void> {
  const metadata = input.status === "completed"
    ? {
      provider: input.provider,
      model: input.model,
      inputTokens: input.usage?.inputTokens ?? 0,
      outputTokens: input.usage?.outputTokens ?? 0,
      finishReason: "stop",
    }
    : null;

  await controlPlaneJson({
    authToken: input.authToken,
    url: `${input.apiUrl}/runs/${input.runId}/complete`,
    method: "POST",
    body: {
      status: input.status,
      metadata,
      terminal_error_code: input.terminalErrorCode ?? null,
      terminal_error_message: input.terminalErrorMessage ?? null,
    },
    responseSchema: CompleteConversationRunResponseSchema,
    operation: "Complete canonical durable run",
  });
}
