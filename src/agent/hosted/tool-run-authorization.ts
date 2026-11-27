import { inheritHostedToolApprovalCapability } from "./tool-approval-capability.ts";
import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";

type ToolRunCarrier = { projectId?: string | null; runId?: string };
type ToolRunBinding = Readonly<{ projectId: string; runId: string; approvalRunId?: string }>;
const bindings = createPrivateWeakStore<ToolRunCarrier, ToolRunBinding>();
const freeze = Object.freeze;

/** Register only after canonical admission or strict executor grant validation. */
export function registerHostedToolRunAuthorization(
  target: ToolRunCarrier,
  binding: ToolRunBinding,
): void {
  bindings.set(
    target,
    freeze({
      projectId: binding.projectId,
      runId: binding.runId,
      ...(binding.approvalRunId === undefined ? {} : { approvalRunId: binding.approvalRunId }),
    }),
  );
}

/** Preserve private admission across trusted runtime option copies. */
export function inheritHostedToolRunAuthorization<T extends ToolRunCarrier>(
  target: T,
  source: ToolRunCarrier,
): T {
  const binding = bindings.get(source);
  if (binding) bindings.set(target, binding);
  inheritHostedToolApprovalCapability(target, source);
  return target;
}

/** Public identifiers and copied JSON fields cannot grant tool authorization. */
export function hasHostedToolRunAuthorization(
  target: ToolRunCarrier,
  context: { projectId?: string; runId?: string },
): boolean {
  const binding = bindings.get(target);
  return binding !== undefined && binding.projectId === context.projectId &&
    binding.runId === context.runId;
}

/** Resolve a verified legacy-to-canonical API route without trusting a public alias field. */
export function getHostedToolApprovalRunId(
  target: ToolRunCarrier,
  context: { projectId?: string; runId?: string },
): string | undefined {
  if (!hasHostedToolRunAuthorization(target, context)) return undefined;
  const binding = bindings.get(target)!;
  return binding.approvalRunId ?? binding.runId;
}
