import { AsyncLocalStorage } from "node:async_hooks";
import { registerVeryfrontCloudContextProvider } from "#veryfront/platform/cloud/context-bridge.ts";

/** Context for Veryfront Cloud. */
export interface VeryfrontCloudContext {
  /** Veryfront API base URL for this asynchronous scope. */
  apiBaseUrl?: string;
  /** Veryfront API token for this asynchronous scope. */
  apiToken?: string;
  /** Billing group attached to gateway requests in this scope. */
  billingGroupId?: string;
  /** Whether a gateway request used the configured billing group. */
  billingGroupUsed?: boolean;
  /** Project slug for this asynchronous scope. */
  projectSlug?: string;
  /** Service layer selected for this asynchronous scope. */
  serviceLayer?: string;
}

const veryfrontCloudContextStorage = new AsyncLocalStorage<VeryfrontCloudContext>();

function provideVeryfrontCloudContext(): VeryfrontCloudContext | undefined {
  return veryfrontCloudContextStorage.getStore();
}

function ensureVeryfrontCloudContextProvider(): void {
  registerVeryfrontCloudContextProvider(provideVeryfrontCloudContext);
}

ensureVeryfrontCloudContextProvider();

/** Context for run with Veryfront Cloud. */
export function runWithVeryfrontCloudContext<T>(
  context: VeryfrontCloudContext,
  fn: () => T,
): T {
  ensureVeryfrontCloudContextProvider();
  return veryfrontCloudContextStorage.run(context, fn);
}

/** Run with Veryfront Cloud context async. */
export function runWithVeryfrontCloudContextAsync<T>(
  context: VeryfrontCloudContext,
  fn: () => Promise<T>,
): Promise<T> {
  ensureVeryfrontCloudContextProvider();
  return veryfrontCloudContextStorage.run(context, fn);
}

/** Return the Veryfront Cloud context for the current asynchronous scope. */
export function getCurrentVeryfrontCloudContext(): VeryfrontCloudContext | undefined {
  ensureVeryfrontCloudContextProvider();
  return provideVeryfrontCloudContext();
}

/** Mark the current billing group as used by a gateway request. */
export function markCurrentVeryfrontCloudBillingGroupUsed(): void {
  ensureVeryfrontCloudContextProvider();
  const context = provideVeryfrontCloudContext();
  if (context?.billingGroupId) {
    context.billingGroupUsed = true;
  }
}
