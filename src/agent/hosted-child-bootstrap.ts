import { bootstrapConversationAgentRun } from "./conversation-bootstrap.ts";
import { type HostedChildRunIdentifiers } from "./hosted-child-status.ts";

export interface HostedChildConversationBodyInput {
  ensureProjectId?: string | null;
  parentConversationId: string;
  parentRunId: string;
  parentMessageId: string;
  spawnedFromToolCallId: string;
  description: string;
}

export interface BootstrapHostedChildRunInput extends HostedChildConversationBodyInput {
  authToken: string;
  apiUrl: string;
  runProjectId?: string | null;
  prompt: string;
  runId?: string;
  agentId: string;
  branchId?: string | null;
}

export interface BootstrapHostedChildRunResult extends HostedChildRunIdentifiers {
  status: "running";
}

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
    agentId: input.agentId,
    projectId: input.runProjectId ?? null,
    branchId: input.branchId,
  });

  return {
    childConversationId: result.conversation.id,
    childRunId: result.run.runId,
    childMessageId: result.run.messageId,
    latestEventId: result.run.latestEventId,
    latestExternalEventSequence: result.run.latestExternalEventSequence,
    status: "running",
  };
}
