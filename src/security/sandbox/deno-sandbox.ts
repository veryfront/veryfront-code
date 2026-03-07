import { DEFAULT_SANDBOX_TIMEOUT_MS } from "./constants.ts";
import { isCompiledBinary, serverLogger } from "#veryfront/utils";
import { isDeno, isNode } from "#veryfront/platform/compat/runtime.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { INVALID_ARGUMENT, NOT_SUPPORTED, TIMEOUT_ERROR, UNKNOWN_ERROR } from "#veryfront/errors";

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
  const timeoutMs = options.timeoutMs ?? DEFAULT_SANDBOX_TIMEOUT_MS;

  return withSpan(
    "security.sandbox.runInWorker",
    () => {
      const workerOptions: ExtendedWorkerOptions = { type: "module" };

      if (isDeno) workerOptions.deno = { permissions: "none" };

      const { memoryLimitMb } = options;
      if (typeof memoryLimitMb === "number") {
        if (!Number.isFinite(memoryLimitMb) || memoryLimitMb <= 0) {
          throw INVALID_ARGUMENT.create({
            detail: "Sandbox memoryLimitMb must be a positive, finite number",
          });
        }
        if (!isNode) {
          throw NOT_SUPPORTED.create({
            detail: "Sandbox memory limits are not supported in this runtime",
          });
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
        : URL.createObjectURL(new Blob([workerCode], { type: "application/javascript" }));

      const worker = new Worker(workerUrl, workerOptions);

      function safeTerminate(logMessage: string, error?: unknown): void {
        try {
          worker.terminate();
        } catch (e) {
          serverLogger.debug(logMessage, { error: error ?? e });
        }
      }

      const promise = new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          safeTerminate("[sandbox] worker terminate failed");
          reject(TIMEOUT_ERROR.create({ detail: "Sandbox timeout" }));
        }, timeoutMs);

        worker.onmessage = (e: MessageEvent) => {
          clearTimeout(timer);

          const { result, error } = e.data ?? {};
          if (error) reject(UNKNOWN_ERROR.create({ detail: error }));
          else resolve(result as T);

          safeTerminate("[sandbox] worker terminate failed");
        };

        worker.onerror = (e) => {
          clearTimeout(timer);
          reject(UNKNOWN_ERROR.create({ detail: String(e.message || e.error || "Worker error") }));
          safeTerminate("[sandbox] worker terminate failed on error");
        };
      });

      worker.postMessage({ code });
      return promise;
    },
    {
      "sandbox.timeoutMs": timeoutMs,
      "sandbox.memoryLimitMb": options.memoryLimitMb ?? 0,
    },
  );
}
