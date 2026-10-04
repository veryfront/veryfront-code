import {
  type HostedRunEventWriterCapability,
  inheritedChildAdmitter,
} from "./child-run-event-writer-token.ts";
import { transferHostedTerminalAuthority } from "./terminal-credential.ts";
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
  runEventWriterCapability?: HostedRunEventWriterCapability;
  authToken: string;
  apiUrl: string;
  runProjectId?: string | null;
  prompt: string;
  runId?: string;
  agentId: string;
  implementationKind?: string | null;
  runtimeTargetKind?: "main_branch" | "environment" | "preview_branch" | null;
  runtimeTargetEnvironmentId?: string | null;
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
  const admitRun = inheritedChildAdmitter(
    input.runEventWriterCapability,
    input.parentRunId,
    input.spawnedFromToolCallId,
    input.prompt,
  );
  const run = await admitRun({
    authToken: input.authToken,
    apiUrl: input.apiUrl,
    parentRunId: input.parentRunId,
    agentId: input.agentId,
    projectId: input.runProjectId ?? input.ensureProjectId ?? null,
  });

  const identifiers = {
    childCanonicalRunId: run.canonicalRunId,
    childConversationId: run.conversationId,
    childRunId: run.runId,
    childMessageId: run.messageId,
    latestEventId: run.latestEventId,
    latestExternalEventSequence: run.latestExternalEventSequence,
    status: run.status,
  };
  transferHostedTerminalAuthority(run, identifiers);
  return identifiers;
}
