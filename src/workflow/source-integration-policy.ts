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
import {
  isNativeErrorWithoutHooks,
  isProxyWithoutHooks,
  sanitizeDiagnosticText,
} from "#veryfront/errors/safe-diagnostics.ts";

const MISSING = Symbol("missing workflow source policy property");
const INVALID = Symbol("invalid workflow source policy property");
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;

function readRunProperty(
  run: unknown,
  key: "id" | "sourceIntegrationPolicy",
): unknown | typeof MISSING | typeof INVALID {
  if (typeof run !== "object" || run === null || isProxyWithoutHooks(run)) return INVALID;
  try {
    const descriptor = objectGetOwnPropertyDescriptor(run, key);
    if (!descriptor) return MISSING;
    return "value" in descriptor ? descriptor.value : INVALID;
  } catch {
    return INVALID;
  }
}

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
  const id = readRunProperty(run, "id");
  const runId = typeof id === "string" ? sanitizeDiagnosticText(id) : "unknown";
  const snapshot = readRunProperty(run, "sourceIntegrationPolicy");
  if (snapshot === MISSING || snapshot === undefined) {
    throw ORCHESTRATION_ERROR.create({
      detail: `Workflow run "${runId}" is missing its source integration policy snapshot.`,
    });
  }
  if (snapshot === INVALID) {
    throw ORCHESTRATION_ERROR.create({
      detail: `Workflow run "${runId}" has an invalid source integration policy snapshot.`,
    });
  }
  try {
    return parseSourceIntegrationPolicyManifest(snapshot);
  } catch (error) {
    throw ORCHESTRATION_ERROR.create({
      detail: `Workflow run "${runId}" has an invalid source integration policy snapshot.`,
      cause: isNativeErrorWithoutHooks(error) ? error : undefined,
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
