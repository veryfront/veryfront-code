import { DEFAULT_SANDBOX_TIMEOUT_MS } from "./constants.ts";
import { serverLogger } from "#veryfront/utils";
import { isCompiledBinary } from "#veryfront/utils";
import { isDeno, isNode } from "#veryfront/platform/compat/runtime.ts";

export interface SandboxOptions {
  timeoutMs?: number;
  memoryLimitMb?: number;
}

type ExtendedWorkerOptions = WorkerOptions & {
  deno?: { permissions: "none" };
  resourceLimits?: {
    maxOldGenerationSizeMb?: number;
    maxYoungGenerationSizeMb?: number;
    codeRangeSizeMb?: number;
    stackSizeMb?: number;
  };
};

export function runInWorker<T = unknown>(code: string, options: SandboxOptions = {}): Promise<T> {
  const workerOptions: ExtendedWorkerOptions = { type: "module" };
  if (isDeno) {
    workerOptions.deno = { permissions: "none" };
  }

  if (typeof options.memoryLimitMb === "number") {
    const limit = options.memoryLimitMb;
    if (!Number.isFinite(limit) || limit <= 0) {
      return Promise.reject(
        new Error("Sandbox memoryLimitMb must be a positive, finite number"),
      );
    }

    if (!isNode) {
      return Promise.reject(
        new Error("Sandbox memory limits are not supported in this runtime"),
      );
    }
    workerOptions.resourceLimits = {
      ...workerOptions.resourceLimits,
      maxOldGenerationSizeMb: Math.floor(limit),
    };
  }

  const workerCode = `self.onmessage = async (e) => {` +
    `  const { code } = e.data;` +
    `  let result;` +
    `  try { result = await (async () => {` +
    `    return await (new Function(code))();` +
    `  })(); } catch (err) {` +
    `    self.postMessage({ error: String(err && err.message || err) });` +
    `    return;` +
    `  }` +
    `  self.postMessage({ result });` +
    `};`;

  // Use data URL for compiled binaries (blob URLs don't work in deno compile)
  // See: https://github.com/denoland/deno/issues/18327
  const workerUrl = isCompiledBinary()
    ? `data:text/javascript;base64,${btoa(workerCode)}`
    : URL.createObjectURL(
      new Blob([workerCode], { type: "application/javascript" }),
    );

  const worker = new Worker(workerUrl, workerOptions);

  const timeout = options.timeoutMs ?? DEFAULT_SANDBOX_TIMEOUT_MS;

  const promise = new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        worker.terminate();
      } catch (e) {
        serverLogger.debug("[sandbox] worker terminate failed", { error: e });
      }
      reject(new Error("Sandbox timeout"));
    }, timeout);

    worker.onmessage = (e: MessageEvent) => {
      clearTimeout(timer);
      const { result, error } = e.data || {};
      if (error) reject(new Error(error));
      else resolve(result as T);
      try {
        worker.terminate();
      } catch (e) {
        serverLogger.debug("[sandbox] worker terminate failed", { error: e });
      }
    };
    worker.onerror = (e) => {
      clearTimeout(timer);
      reject(new Error(String(e.message || e.error || "Worker error")));
      try {
        worker.terminate();
      } catch (e) {
        serverLogger.debug("[sandbox] worker terminate failed on error", { error: e });
      }
    };
  });

  worker.postMessage({ code });
  return promise;
}
