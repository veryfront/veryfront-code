import {
  type DefaultResearchArtifactContext,
  extractLatestUserText,
  updateDefaultResearchArtifacts,
} from "../artifacts/default-research-artifact-support.ts";
import {
  addFirstTurnStarterIntentRootOwnershipReminder,
  addSlashCommandArtifactReminder,
  evaluateStarterIntentTurnPolicy,
  FIRST_TURN_STARTER_INTENT_ROOT_OWNERSHIP_CONTEXT_KEY,
} from "../conversation/delegation-policy.ts";
import type { AgentSystem, ResolvedRuntimeState } from "#veryfront/agent/types.ts";
import type { ChatSystemMessage } from "#veryfront/chat/types.ts";
import { evaluateSlashCommandArtifactPolicy } from "../artifacts/slash-command-artifact-policy.ts";
import { SUBMITTED_FORM_INPUT_CONTEXT_KEY } from "../runtime/skill-policy-enforcement.ts";

/** Context for hosted runtime state resolver. */
export type HostedRuntimeStateResolverContext = DefaultResearchArtifactContext & {
  projectId?: string | null;
  branchId?: string | null;
  steeringRevision?: number;
  slashCommandArtifactPathSeen?: boolean;
  userId?: string | null;
  submittedFormInputResult?: unknown;
};

/** Input payload for hosted runtime state resolver. */
export type HostedRuntimeStateResolverInput = {
  context?: Record<string, unknown>;
  system: string;
  structuredSystem?: readonly ChatSystemMessage[];
  messages: readonly unknown[];
  step: number;
};

/** Result returned from hosted runtime state resolver. */
export type HostedRuntimeStateResolverResult = ResolvedRuntimeState & {
  context: Record<string, unknown>;
};

/** Input payload for hosted runtime system refresh. */
export type HostedRuntimeSystemRefreshInput<TContext extends HostedRuntimeStateResolverContext> = {
  taskContext: TContext;
  system: AgentSystem;
};

/** Public API contract for hosted runtime system refresh. */
export type HostedRuntimeSystemRefresh<TContext extends HostedRuntimeStateResolverContext> = (
  input: HostedRuntimeSystemRefreshInput<TContext>,
) => Promise<AgentSystem> | AgentSystem;

/** Options accepted by create hosted runtime state resolver. */
export type CreateHostedRuntimeStateResolverOptions<
  TContext extends HostedRuntimeStateResolverContext,
> = {
  taskContext: TContext;
  refreshSystem?: HostedRuntimeSystemRefresh<TContext>;
};

function activeProjectId(context: HostedRuntimeStateResolverContext): string | null {
  return context.projectId ?? null;
}

function activeBranchId(context: HostedRuntimeStateResolverContext): string | null {
  return context.branchId ?? null;
}

function steeringRevision(context: HostedRuntimeStateResolverContext): number {
  return context.steeringRevision ?? 0;
}

/** Create hosted runtime state resolver. */
export function createHostedRuntimeStateResolver<
  TContext extends HostedRuntimeStateResolverContext,
>(
  options: CreateHostedRuntimeStateResolverOptions<TContext>,
): (input: HostedRuntimeStateResolverInput) => Promise<HostedRuntimeStateResolverResult> {
  let lastAppliedSteeringRevision = steeringRevision(options.taskContext);
  let lastAppliedProjectId = activeProjectId(options.taskContext);
  let lastAppliedBranchId = activeBranchId(options.taskContext);

  return async ({ context, system, structuredSystem, messages, step }) => {
    const currentSteeringRevision = steeringRevision(options.taskContext);
    const currentProjectId = activeProjectId(options.taskContext);
    const currentBranchId = activeBranchId(options.taskContext);
    const steeringChanged = currentSteeringRevision !== lastAppliedSteeringRevision ||
      currentProjectId !== lastAppliedProjectId ||
      currentBranchId !== lastAppliedBranchId;

    let nextSystem: AgentSystem = structuredSystem === undefined ? system : [...structuredSystem];
    const nextContextRecord = { ...(context ?? {}) };
    if (options.taskContext.submittedFormInputResult) {
      nextContextRecord[SUBMITTED_FORM_INPUT_CONTEXT_KEY] = true;
    }

    if (steeringChanged && options.refreshSystem) {
      nextSystem = await options.refreshSystem({
        taskContext: options.taskContext,
        system: nextSystem,
      });

      lastAppliedSteeringRevision = currentSteeringRevision;
      lastAppliedProjectId = currentProjectId;
      lastAppliedBranchId = currentBranchId;
    }

    const latestUserText = extractLatestUserText(messages);
    if (latestUserText) {
      const reminded = updateDefaultResearchArtifacts({
        taskContext: options.taskContext,
        latestUserText,
        system: nextSystem,
      });
      nextSystem = reminded;
    }

    const starterIntentPolicy = evaluateStarterIntentTurnPolicy({
      messages,
      step,
    });

    if (starterIntentPolicy.shouldAddRootOwnershipReminder) {
      nextSystem = addFirstTurnStarterIntentRootOwnershipReminder(nextSystem);
    }

    if (starterIntentPolicy.shouldBlockImmediateDelegation) {
      nextContextRecord[FIRST_TURN_STARTER_INTENT_ROOT_OWNERSHIP_CONTEXT_KEY] = true;
    } else {
      delete nextContextRecord[FIRST_TURN_STARTER_INTENT_ROOT_OWNERSHIP_CONTEXT_KEY];
    }

    const slashCommandArtifactPolicy = evaluateSlashCommandArtifactPolicy({
      messages,
      slashCommandArtifactPathSeen: options.taskContext.slashCommandArtifactPathSeen,
    });

    if (slashCommandArtifactPolicy.shouldKeepReminder) {
      nextSystem = addSlashCommandArtifactReminder(nextSystem);
    }

    return typeof nextSystem === "string"
      ? { system: nextSystem, context: nextContextRecord }
      : { structuredSystem: nextSystem, context: nextContextRecord };
  };
}
