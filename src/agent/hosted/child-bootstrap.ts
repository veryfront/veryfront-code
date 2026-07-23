import { bootstrapConversationAgentRun } from "../conversation/bootstrap.ts";
import { type ConversationRunProjection } from "../conversation/durable.ts";
import { type HostedChildRunIdentifiers } from "./child-status.ts";

/** Input payload for hosted child conversation body. */
export interface HostedChildConversationBodyInput {
  /** Ensure project ID value. */
  ensureProjectId?: string | null;
  /** Parent conversation ID value. */
  parentConversationId: string;
  /** Parent run ID value. */
  parentRunId: string;
  /** Parent message ID value. */
  parentMessageId: string;
  /** Spawned from tool call ID value. */
  spawnedFromToolCallId: string;
  /** Description value. */
  description: string;
}

/** Input payload for bootstrap hosted child run. */
export interface BootstrapHostedChildRunInput extends HostedChildConversationBodyInput {
  /** Bearer token used for authenticated API requests. */
  authToken: string;
  /** Base URL for Veryfront API requests. */
  apiUrl: string;
  /** Run project ID value. */
  runProjectId?: string | null;
  /** Prompt value. */
  prompt: string;
  /** Run ID value. */
  runId?: string;
  /** Agent ID value. */
  agentId: string;
  /** Implementation kind value. */
  implementationKind?: string | null;
  /** Runtime target kind value. */
  runtimeTargetKind?: "main_branch" | "environment" | "preview_branch" | null;
  /** Runtime target environment ID value. */
  runtimeTargetEnvironmentId?: string | null;
  /** Branch ID value. */
  branchId?: string | null;
}

/** Result returned from bootstrap hosted child run. */
export interface BootstrapHostedChildRunResult extends HostedChildRunIdentifiers {
  /** Status. */
  status: ConversationRunProjection["status"];
}

/** Request body used to create a durable child conversation. */
export interface HostedChildConversationBody {
  /** Optional project scope for the child conversation. */
  project_id?: string;
  /** Conversation type understood by the control plane. */
  type: "project_agent";
  /** Display title derived from the delegated task description. */
  title: string;
  /** Hidden child-run lineage metadata. */
  metadata: {
    /** Whether chat-list surfaces omit the child conversation. */
    hiddenFromChatList: true;
    /** Parent identifiers that establish durable child lineage. */
    projectAgentChildRun: {
      /** Parent conversation identifier. */
      parentConversationId: string;
      /** Parent run identifier. */
      parentRunId: string;
      /** Parent message that spawned the child. */
      spawnedFromMessageId: string;
      /** Tool call that spawned the child. */
      spawnedFromToolCallId: string;
      /** Delegated task description. */
      description: string;
    };
  };
}

/** Builds hosted child conversation body. */
export function buildHostedChildConversationBody(
  input: HostedChildConversationBodyInput,
): HostedChildConversationBody {
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
    runtimeTargetKind: input.runtimeTargetKind,
    runtimeTargetEnvironmentId: input.runtimeTargetEnvironmentId,
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
