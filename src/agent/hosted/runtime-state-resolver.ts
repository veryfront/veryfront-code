import {
  type DefaultResearchArtifactContext,
  extractLatestUserText,
  updateDefaultResearchArtifacts,
} from "../default-research-artifact-support.ts";
import {
  addFirstTurnStarterIntentRootOwnershipReminder,
  addSlashCommandArtifactReminder,
  evaluateStarterIntentTurnPolicy,
  FIRST_TURN_STARTER_INTENT_ROOT_OWNERSHIP_CONTEXT_KEY,
} from "../conversation/delegation-policy.ts";
import { evaluateSlashCommandArtifactPolicy } from "../slash-command-artifact-policy.ts";
import { flattenSystemInstructions } from "../runtime/tool-inventory.ts";

export type HostedRuntimeStateResolverContext = DefaultResearchArtifactContext & {
  projectId?: string | null;
  branchId?: string | null;
  steeringRevision?: number;
  slashCommandArtifactPathSeen?: boolean;
};

export type HostedRuntimeStateResolverInput = {
  context?: Record<string, unknown>;
  system: string;
  messages: readonly unknown[];
  step: number;
};

export type HostedRuntimeStateResolverResult = {
  system: string;
  context: Record<string, unknown>;
};

export type HostedRuntimeSystemRefreshInput<TContext extends HostedRuntimeStateResolverContext> = {
  taskContext: TContext;
  system: string;
};

export type HostedRuntimeSystemRefresh<TContext extends HostedRuntimeStateResolverContext> = (
  input: HostedRuntimeSystemRefreshInput<TContext>,
) => Promise<string> | string;

export type CreateHostedRuntimeStateResolverOptions<
  TContext extends HostedRuntimeStateResolverContext,
> = {
  taskContext: TContext;
  refreshSystem?: HostedRuntimeSystemRefresh<TContext>;
};

function activeProjectId(context: HostedRuntimeStateResolverContext): string | null {
  return context.projectId || null;
}

function activeBranchId(context: HostedRuntimeStateResolverContext): string | null {
  return context.branchId ?? null;
}

function steeringRevision(context: HostedRuntimeStateResolverContext): number {
  return context.steeringRevision ?? 0;
}

export function createHostedRuntimeStateResolver<
  TContext extends HostedRuntimeStateResolverContext,
>(
  options: CreateHostedRuntimeStateResolverOptions<TContext>,
): (input: HostedRuntimeStateResolverInput) => Promise<HostedRuntimeStateResolverResult> {
  let lastAppliedSteeringRevision = steeringRevision(options.taskContext);
  let lastAppliedProjectId = activeProjectId(options.taskContext);
  let lastAppliedBranchId = activeBranchId(options.taskContext);

  return async ({ context, system, messages, step }) => {
    const currentSteeringRevision = steeringRevision(options.taskContext);
    const currentProjectId = activeProjectId(options.taskContext);
    const currentBranchId = activeBranchId(options.taskContext);
    const steeringChanged = currentSteeringRevision !== lastAppliedSteeringRevision ||
      currentProjectId !== lastAppliedProjectId ||
      currentBranchId !== lastAppliedBranchId;

    let nextSystem = system;
    const nextContextRecord = { ...(context ?? {}) };

    if (steeringChanged && options.refreshSystem) {
      nextSystem = await options.refreshSystem({
        taskContext: options.taskContext,
        system,
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
      nextSystem = typeof reminded === "string" ? reminded : flattenSystemInstructions(reminded);
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
      const reminded = addSlashCommandArtifactReminder(nextSystem);
      nextSystem = typeof reminded === "string" ? reminded : flattenSystemInstructions(reminded);
    }

    return {
      system: nextSystem,
      context: nextContextRecord,
    };
  };
}
