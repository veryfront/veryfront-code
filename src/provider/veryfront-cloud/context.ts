import { AsyncLocalStorage } from "node:async_hooks";
import type { AgentRunModelCallCaptureReceipt } from "#veryfront/runtime/model-call-capture-receipt.ts";

/** Context for Veryfront Cloud. */
export interface VeryfrontCloudContext {
  apiBaseUrl?: string;
  apiToken?: string;
  billingGroupId?: string;
  billingGroupUsed?: boolean;
  /**
   * Set once a billed gateway request got past admission, meaning the gateway
   * could have recorded usage under `billingGroupId`. A 401, 402, or 403
   * admission rejection does not set it.
   */
  billingGroupRequestAdmitted?: boolean;
  projectSlug?: string;
  serviceLayer?: string;
  /**
   * Names the model catalog loaded for credentials this context does not hold,
   * so synchronous model reads in a credential-free context use the same
   * catalog as the run. It carries no credential.
   */
  catalogScopeKey?: string;
}

const veryfrontCloudContextStorage = new AsyncLocalStorage<VeryfrontCloudContext>();
const modelCallCaptureStorage = new AsyncLocalStorage<{
  readonly receipt: Readonly<AgentRunModelCallCaptureReceipt> | undefined;
  readonly assertActive: () => void;
}>();

/** Internal dispatch scope, independent of caller-set Cloud context and model options. */
export function runWithVeryfrontCloudModelCallCapture<T>(
  scope: { receipt: AgentRunModelCallCaptureReceipt | undefined; assertActive: () => void },
  operation: () => T,
): T {
  scope.assertActive();
  return modelCallCaptureStorage.run({
    receipt: scope.receipt === undefined ? undefined : Object.freeze({ ...scope.receipt }),
    assertActive: scope.assertActive,
  }, operation);
}

/** Read only the capture scope installed by the acknowledged hosted dispatch permit. */
export function getCurrentVeryfrontCloudModelCallCapture():
  | Readonly<AgentRunModelCallCaptureReceipt>
  | undefined {
  const scope = modelCallCaptureStorage.getStore();
  if (!scope) return undefined;
  scope.assertActive();
  return scope.receipt;
}

/** Context for run with Veryfront Cloud. */
export function runWithVeryfrontCloudContext<T>(
  context: VeryfrontCloudContext,
  fn: () => T,
): T {
  return veryfrontCloudContextStorage.run(context, fn);
}

/** Run with Veryfront Cloud context async. */
export function runWithVeryfrontCloudContextAsync<T>(
  context: VeryfrontCloudContext,
  fn: () => Promise<T>,
): Promise<T> {
  return veryfrontCloudContextStorage.run(context, fn);
}

export function getCurrentVeryfrontCloudContext(): VeryfrontCloudContext | undefined {
  return veryfrontCloudContextStorage.getStore();
}

export function markCurrentVeryfrontCloudBillingGroupUsed(): void {
  const context = veryfrontCloudContextStorage.getStore();
  if (context?.billingGroupId) {
    context.billingGroupUsed = true;
  }
}
