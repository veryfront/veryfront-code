import { bootstrapConversationAgentRun } from "../conversation/bootstrap.ts";
import { type ConversationRunProjection } from "../conversation/durable.ts";
import { type HostedChildRunIdentifiers } from "./child-status.ts";

/** Input payload for hosted child conversation body. */
export interface HostedChildConversationBodyInput {
  ensureProjectId?: string | null;
  parentConversationId: string;
  parentRunId: string;
  parentMessageId: string;
  spawnedFromToolCallId: string;
  description: string;
}

/** Input payload for bootstrap hosted child run. */
export interface BootstrapHostedChildRunInput extends HostedChildConversationBodyInput {
  authToken: string;
  apiUrl: string;
  runProjectId?: string | null;
  prompt: string;
  runId?: string;
  agentId: string;
  implementationKind?: string | null;
  branchId?: string | null;
}

/** Result returned from bootstrap hosted child run. */
export interface BootstrapHostedChildRunResult extends HostedChildRunIdentifiers {
  status: ConversationRunProjection["status"];
}

/** Builds hosted child conversation body. */
export function buildHostedChildConversationBody(input: HostedChildConversationBodyInput) {
  return {
    ...(input.ensureProjectId ? { project_id: input.ensureProjectId } : {}),
    type: "project_agent" as const,
    title: input.description,
    metadata: {
      hiddenFromChatList: true,
      projectAgentChildRun: {
        parentConversationId: input.parentConversationId,
        parentRunId: input.parentRunId,
        spawnedFromMessageId: input.parentMessageId,
        spawnedFromToolCallId: input.spawnedFromToolCallId,
        description: input.description,
      },
    },
  };
}

/** Bootstrap hosted child run helper. */
export async function bootstrapHostedChildRun(
  input: BootstrapHostedChildRunInput,
): Promise<BootstrapHostedChildRunResult> {
  const result = await bootstrapConversationAgentRun({
    authToken: input.authToken,
    apiUrl: input.apiUrl,
    parentConversationId: input.parentConversationId,
    ensureProjectId: input.ensureProjectId ?? undefined,
    conversationBody: buildHostedChildConversationBody(input),
    handoffMessageBody: {
      role: "user",
      parts: [{ type: "text", text: input.prompt }],
    },
    runId: input.runId,
    parentRunId: input.parentRunId,
    agentId: input.agentId,
    implementationKind: input.implementationKind,
    projectId: input.runProjectId ?? null,
    branchId: input.branchId,
  });

  return {
    childConversationId: result.conversation.id,
    childRunId: result.run.runId,
    childMessageId: result.run.messageId,
    latestEventId: result.run.latestEventId,
    latestExternalEventSequence: result.run.latestExternalEventSequence,
    status: result.run.status,
  };
}
