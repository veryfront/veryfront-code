import { ORCHESTRATION_ERROR } from "#veryfront/errors";
import {
  normalizeSourceIntegrationPolicy,
  parseSourceIntegrationPolicyManifest,
  type SourceIntegrationPolicyManifest,
} from "#veryfront/integrations/source-policy.ts";
import {
  getActiveSourceIntegrationPolicy,
  runWithEffectiveSourceIntegrationPolicy,
} from "#veryfront/integrations/source-policy-context.ts";
import type { WorkflowRun } from "./types.ts";

/** Capture an immutable-by-value policy snapshot for a newly created workflow run. */
export function captureWorkflowSourceIntegrationPolicy(): SourceIntegrationPolicyManifest {
  return parseSourceIntegrationPolicyManifest(
    getActiveSourceIntegrationPolicy() ?? normalizeSourceIntegrationPolicy(undefined),
  );
}

/** Require the policy snapshot that belongs to the source which created this run. */
export function requireWorkflowSourceIntegrationPolicy(
  run: Pick<WorkflowRun, "id" | "sourceIntegrationPolicy">,
): SourceIntegrationPolicyManifest {
  const snapshot: unknown = run.sourceIntegrationPolicy;
  if (snapshot === undefined) {
    throw ORCHESTRATION_ERROR.create({
      detail: `Workflow run "${run.id}" is missing its source integration policy snapshot.`,
    });
  }
  try {
    return parseSourceIntegrationPolicyManifest(snapshot);
  } catch (error) {
    throw ORCHESTRATION_ERROR.create({
      detail: `Workflow run "${run.id}" has an invalid source integration policy snapshot.`,
      cause: error instanceof Error ? error : undefined,
    });
  }
}

/** Restore a run snapshot without allowing an active reloaded source to widen it. */
export function runWithWorkflowSourceIntegrationPolicy<T>(
  run: Pick<WorkflowRun, "id" | "sourceIntegrationPolicy">,
  fn: () => T,
): T {
  return runWithEffectiveSourceIntegrationPolicy(
    requireWorkflowSourceIntegrationPolicy(run),
    fn,
  );
}
