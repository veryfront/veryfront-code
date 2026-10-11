import { createPrivateAsyncLocalStorage } from "#veryfront/security/private-async-context.ts";
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

const veryfrontCloudContextStorage = createPrivateAsyncLocalStorage<VeryfrontCloudContext>();
const modelCallCaptureStorage = createPrivateAsyncLocalStorage<{
  readonly receipt: Readonly<AgentRunModelCallCaptureReceipt> | undefined;
  readonly assertActive: () => void;
}>();
const ReflectApply = Reflect.apply;
const ObjectFreeze = Object.freeze;
const veryfrontCloudContextRun = veryfrontCloudContextStorage.run;
const veryfrontCloudContextGetStore = veryfrontCloudContextStorage.getStore;
const modelCallCaptureRun = modelCallCaptureStorage.run;
const modelCallCaptureGetStore = modelCallCaptureStorage.getStore;

function freezeModelCallCaptureReceipt(
  receipt: AgentRunModelCallCaptureReceipt,
): Readonly<AgentRunModelCallCaptureReceipt> {
  return ReflectApply(ObjectFreeze, Object, [{
    eventId: receipt.eventId,
    projectId: receipt.projectId,
    runId: receipt.runId,
    modelCallId: receipt.modelCallId,
  }]) as Readonly<AgentRunModelCallCaptureReceipt>;
}

/** Internal dispatch scope, independent of caller-set Cloud context and model options. */
export function runWithVeryfrontCloudModelCallCapture<T>(
  scope: { receipt: AgentRunModelCallCaptureReceipt | undefined; assertActive: () => void },
  operation: () => T,
): T {
  scope.assertActive();
  return ReflectApply(modelCallCaptureRun, modelCallCaptureStorage, [{
    receipt: scope.receipt === undefined ? undefined : freezeModelCallCaptureReceipt(scope.receipt),
    assertActive: scope.assertActive,
  }, operation]) as T;
}

/** Read only the capture scope installed by the acknowledged hosted dispatch permit. */
export function getCurrentVeryfrontCloudModelCallCapture():
  | Readonly<AgentRunModelCallCaptureReceipt>
  | undefined {
  const scope = ReflectApply(modelCallCaptureGetStore, modelCallCaptureStorage, []) as
    | {
      readonly receipt: Readonly<AgentRunModelCallCaptureReceipt> | undefined;
      readonly assertActive: () => void;
    }
    | undefined;
  if (!scope) return undefined;
  scope.assertActive();
  return scope.receipt;
}

/** Context for run with Veryfront Cloud. */
export function runWithVeryfrontCloudContext<T>(
  context: VeryfrontCloudContext,
  fn: () => T,
): T {
  return ReflectApply(veryfrontCloudContextRun, veryfrontCloudContextStorage, [context, fn]) as T;
}

/** Run with Veryfront Cloud context async. */
export function runWithVeryfrontCloudContextAsync<T>(
  context: VeryfrontCloudContext,
  fn: () => Promise<T>,
): Promise<T> {
  return ReflectApply(veryfrontCloudContextRun, veryfrontCloudContextStorage, [
    context,
    fn,
  ]) as Promise<T>;
}

export function getCurrentVeryfrontCloudContext(): VeryfrontCloudContext | undefined {
  return ReflectApply(veryfrontCloudContextGetStore, veryfrontCloudContextStorage, []) as
    | VeryfrontCloudContext
    | undefined;
}

export function markCurrentVeryfrontCloudBillingGroupUsed(): void {
  const context = ReflectApply(veryfrontCloudContextGetStore, veryfrontCloudContextStorage, []) as
    | VeryfrontCloudContext
    | undefined;
  if (context?.billingGroupId) {
    context.billingGroupUsed = true;
  }
}
