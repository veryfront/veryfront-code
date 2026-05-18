import { AsyncLocalStorage } from "node:async_hooks";

/** Context for Veryfront Cloud. */
export interface VeryfrontCloudContext {
  apiBaseUrl?: string;
  apiToken?: string;
  projectSlug?: string;
  serviceLayer?: string;
}

const veryfrontCloudContextStorage = new AsyncLocalStorage<VeryfrontCloudContext>();

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
