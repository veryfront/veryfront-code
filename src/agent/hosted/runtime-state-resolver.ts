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
import { evaluateSlashCommandArtifactPolicy } from "../artifacts/slash-command-artifact-policy.ts";
import { flattenSystemInstructions } from "../runtime/tool-inventory.ts";
import { SUBMITTED_FORM_INPUT_CONTEXT_KEY } from "../runtime/skill-policy-enforcement.ts";
import type { ToolExecutionContext } from "#veryfront/tool";
import {
  applyRuntimeToolExecutionIdentity,
  type RuntimeToolExecutionIdentity,
} from "../runtime/runtime-tool-config.ts";

/** Context for hosted runtime state resolver. */
export type HostedRuntimeStateResolverContext = DefaultResearchArtifactContext & {
  authToken?: string;
  projectId?: string | null;
  projectSlug?: string;
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
  messages: readonly unknown[];
  step: number;
  abortSignal?: AbortSignal;
};

/** Result returned from hosted runtime state resolver. */
export type HostedRuntimeStateResolverResult = {
  system: string;
  context: Record<string, unknown>;
};

/** Input payload for hosted runtime system refresh. */
export type HostedRuntimeSystemRefreshInput<TContext extends HostedRuntimeStateResolverContext> = {
  taskContext: TContext;
  system: string;
  abortSignal?: AbortSignal;
};

/** Public API contract for hosted runtime system refresh. */
export type HostedRuntimeSystemRefresh<TContext extends HostedRuntimeStateResolverContext> = (
  input: HostedRuntimeSystemRefreshInput<TContext>,
) => Promise<string> | string;

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

/**
 * Read the host-owned credential identity as one atomic bundle.
 *
 * The task context is intentionally read when this function is called. Project
 * navigation mutates that live context, so execution boundaries can bind every
 * sibling tool call to the identity that is current at that exact moment.
 */
export function resolveHostedToolExecutionIdentity(
  taskContext: HostedRuntimeStateResolverContext,
): RuntimeToolExecutionIdentity {
  if (!Object.hasOwn(taskContext, "authToken")) {
    // An installed hosted resolver owns credential selection even when the
    // application removes its credential. Preserve that ownership explicitly
    // so downstream integration and MCP resolution cannot fall back to
    // request-scoped or process-wide credentials. Project identity is omitted
    // with the missing credential as one atomic bundle.
    return { authToken: undefined };
  }

  // Keep an explicitly owned (including invalid/undefined) credential
  // explicit so downstream resolution fails closed instead of falling back to
  // process credentials.
  const identity: RuntimeToolExecutionIdentity = {
    authToken: taskContext.authToken,
  };
  const currentProjectId = activeProjectId(taskContext);
  if (currentProjectId) {
    identity.projectId = currentProjectId;
  }
  const currentProjectSlug = taskContext.projectSlug?.trim() || undefined;
  if (currentProjectSlug) {
    identity.projectSlug = currentProjectSlug;
  }

  return identity;
}

/** Merge the current hosted credential identity into a tool context. */
export function resolveHostedToolExecutionContext(
  taskContext: HostedRuntimeStateResolverContext,
  context: Record<string, unknown> | undefined,
): ToolExecutionContext {
  return applyRuntimeToolExecutionIdentity(
    { ...(context ?? {}) },
    resolveHostedToolExecutionIdentity(taskContext),
  );
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

  return async ({ context, system, messages, step, abortSignal }) => {
    const currentSteeringRevision = steeringRevision(options.taskContext);
    const currentProjectId = activeProjectId(options.taskContext);
    const currentBranchId = activeBranchId(options.taskContext);
    const steeringChanged = currentSteeringRevision !== lastAppliedSteeringRevision ||
      currentProjectId !== lastAppliedProjectId ||
      currentBranchId !== lastAppliedBranchId;

    let nextSystem = system;
    // Step boundaries and individual tool execution share one credential
    // identity normalization path.
    const nextContextRecord = resolveHostedToolExecutionContext(options.taskContext, context);
    if (options.taskContext.submittedFormInputResult) {
      nextContextRecord[SUBMITTED_FORM_INPUT_CONTEXT_KEY] = true;
    }

    if (steeringChanged && options.refreshSystem) {
      nextSystem = await options.refreshSystem({
        taskContext: options.taskContext,
        system,
        ...(abortSignal === undefined ? {} : { abortSignal }),
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
