import { AsyncLocalStorage } from "node:async_hooks";

export interface VeryfrontCloudContext {
  apiBaseUrl?: string;
  apiToken?: string;
  projectSlug?: string;
  serviceLayer?: string;
}

const veryfrontCloudContextStorage = new AsyncLocalStorage<VeryfrontCloudContext>();

export function runWithVeryfrontCloudContext<T>(
  context: VeryfrontCloudContext,
  fn: () => T,
): T {
  return veryfrontCloudContextStorage.run(context, fn);
}

export function runWithVeryfrontCloudContextAsync<T>(
  context: VeryfrontCloudContext,
  fn: () => Promise<T>,
): Promise<T> {
  return veryfrontCloudContextStorage.run(context, fn);
}

export function getCurrentVeryfrontCloudContext(): VeryfrontCloudContext | undefined {
  return veryfrontCloudContextStorage.getStore();
}
