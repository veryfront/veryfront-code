import { DEFAULT_SANDBOX_TIMEOUT_MS } from "./constants.ts";
import { serverLogger } from "@veryfront/utils";
import { isCompiledBinary } from "@veryfront/utils";

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
  if (typeof Deno !== "undefined") {
    workerOptions.deno = { permissions: "none" };
  }

  if (typeof options.memoryLimitMb === "number") {
    const limit = options.memoryLimitMb;
    if (!Number.isFinite(limit) || limit <= 0) {
      return Promise.reject(
        new Error("Sandbox memoryLimitMb must be a positive, finite number"),
      );
    }

    const processGlobal = (globalThis as { process?: { versions?: { node?: string } } }).process;
    const isNodeRuntime = typeof Deno === "undefined" &&
      typeof processGlobal?.versions?.node === "string";

    if (isNodeRuntime) {
      workerOptions.resourceLimits = {
        ...workerOptions.resourceLimits,
        maxOldGenerationSizeMb: Math.floor(limit),
      };
    } else {
      return Promise.reject(
        new Error("Sandbox memory limits are not supported in this runtime"),
      );
    }
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

  const isDataUrl = isCompiledBinary();
  const workerUrl = isDataUrl
    ? `data:text/javascript;base64,${btoa(workerCode)}`
    : URL.createObjectURL(
      new Blob([workerCode], { type: "application/javascript" }),
    );

  const worker = new Worker(workerUrl, workerOptions);

  const timeout = options.timeoutMs ?? DEFAULT_SANDBOX_TIMEOUT_MS;

  /**
   * Cleanup function to properly terminate worker and revoke object URL
   */
  function cleanup(): void {
    try {
      worker.terminate();
    } catch (e) {
      serverLogger.debug("[sandbox] worker terminate failed", { error: e });
    }
    // Revoke the object URL to prevent memory leaks (only for blob URLs)
    if (!isDataUrl) {
      try {
        URL.revokeObjectURL(workerUrl);
      } catch (e) {
        serverLogger.debug("[sandbox] URL revoke failed", { error: e });
      }
    }
  }

  const promise = new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Sandbox timeout"));
    }, timeout);

    worker.onmessage = (e: MessageEvent) => {
      clearTimeout(timer);
      const { result, error } = e.data || {};
      cleanup();
      if (error) {
        reject(new Error(error));
      } else {
        resolve(result as T);
      }
    };

    worker.onerror = (e) => {
      clearTimeout(timer);
      cleanup();
      reject(new Error(String(e.message || e.error || "Worker error")));
    };
  });

  worker.postMessage({ code });
  return promise;
}
