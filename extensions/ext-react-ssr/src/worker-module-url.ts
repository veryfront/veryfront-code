/** Resolve the sibling renderer emitted for the active distribution format. */
export function resolveReactSsrWorkerModuleUrl(moduleUrl: string): string {
  const workerFile = moduleUrl.endsWith(".ts") ? "./worker-renderer.ts" : "./worker-renderer.js";
  return new URL(workerFile, moduleUrl).href;
}

/** Resolve the smallest read root containing the active worker module graph. */
export function resolveReactSsrWorkerReadRootUrl(moduleUrl: string): string {
  return new URL(moduleUrl.endsWith(".ts") ? "./" : "../", moduleUrl).href;
}
