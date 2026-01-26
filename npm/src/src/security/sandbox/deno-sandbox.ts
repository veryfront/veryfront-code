import * as dntShim from "../../../_dnt.shims.js";
import { DEFAULT_SANDBOX_TIMEOUT_MS } from "./constants.js";
import { isCompiledBinary, serverLogger } from "../../utils/index.js";
import { isDeno, isNode } from "../../platform/compat/runtime.js";
import { withSpan } from "../../observability/tracing/otlp-setup.js";

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
  return withSpan(
    "security.sandbox.runInWorker",
    () => {
      const workerOptions: ExtendedWorkerOptions = { type: "module" };

      if (isDeno) {
        workerOptions.deno = { permissions: "none" };
      }

      const memoryLimitMb = options.memoryLimitMb;
      if (typeof memoryLimitMb === "number") {
        if (!Number.isFinite(memoryLimitMb) || memoryLimitMb <= 0) {
          throw new Error("Sandbox memoryLimitMb must be a positive, finite number");
        }
        if (!isNode) {
          throw new Error("Sandbox memory limits are not supported in this runtime");
        }

        workerOptions.resourceLimits = {
          ...workerOptions.resourceLimits,
          maxOldGenerationSizeMb: Math.floor(memoryLimitMb),
        };
      }

      const workerCode = `self.onmessage = async (e) => {` +
        `  const { code } = e.data;` +
        `  let result;` +
        `  try { result = await (async () => {` +
        `    return await (new Function(code))();` +
        `  })(); } catch (error) {` +
        `    self.postMessage({ error: String(error && error.message || error) });` +
        `    return;` +
        `  }` +
        `  self.postMessage({ result });` +
        `};`;

      // Use data URL for compiled binaries (blob URLs don't work in deno compile)
      // See: https://github.com/denoland/deno/issues/18327
      const workerUrl = isCompiledBinary()
        ? `data:text/javascript;base64,${btoa(workerCode)}`
        : URL.createObjectURL(new dntShim.Blob([workerCode], { type: "application/javascript" }));

      const worker = new Worker(workerUrl, workerOptions);
      const timeoutMs = options.timeoutMs ?? DEFAULT_SANDBOX_TIMEOUT_MS;

      function safeTerminate(logMessage: string, error?: unknown): void {
        try {
          worker.terminate();
        } catch (e) {
          serverLogger.debug(logMessage, { error: error ?? e });
        }
      }

      const promise = new Promise<T>((resolve, reject) => {
        const timer = dntShim.setTimeout(() => {
          safeTerminate("[sandbox] worker terminate failed");
          reject(new Error("Sandbox timeout"));
        }, timeoutMs);

        worker.onmessage = (e: MessageEvent) => {
          clearTimeout(timer);

          const { result, error } = e.data ?? {};
          if (error) reject(new Error(error));
          else resolve(result as T);

          safeTerminate("[sandbox] worker terminate failed");
        };

        worker.onerror = (e) => {
          clearTimeout(timer);
          reject(new Error(String(e.message || e.error || "Worker error")));
          safeTerminate("[sandbox] worker terminate failed on error");
        };
      });

      worker.postMessage({ code });
      return promise;
    },
    {
      "sandbox.timeoutMs": options.timeoutMs ?? DEFAULT_SANDBOX_TIMEOUT_MS,
      "sandbox.memoryLimitMb": options.memoryLimitMb ?? 0,
    },
  );
}
