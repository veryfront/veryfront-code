import { DEFAULT_SANDBOX_TIMEOUT_MS, MAX_SANDBOX_CODE_SIZE } from "./constants.ts";
import { isCompiledBinary, serverLogger } from "#veryfront/utils";
import { isBun, isDeno, isNode } from "#veryfront/platform/compat/runtime.ts";
import { getHostEnv } from "#veryfront/platform/compat/process/env.ts";
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

/**
 * Operator opt-in env var that allows {@link runInWorker} to execute on Node.js
 * despite the lack of permission isolation. Read via {@link getHostEnv} so that
 * a per-request project env overlay cannot enable unsafe execution from inside
 * a tenant context.
 *
 * @internal Exported for testing.
 */
export const NODE_SANDBOX_ALLOW_UNSAFE_ENV = "VERYFRONT_NODE_SANDBOX_ALLOW_UNSAFE";

/**
 * Pure decision helper for the Node.js sandbox guard. Given the raw env-var
 * value, decide whether to block execution on Node.
 *
 * Returns `true` only when the value is the literal string `"1"`. Any other
 * value (including `"true"`, `"yes"`, whitespace, or empty string) keeps the
 * guard active. Strict equality is intentional for a security opt-in.
 *
 * @internal Exported for testing only.
 */
export function isNodeSandboxAllowedUnsafe(envValue: string | undefined): boolean {
  return envValue === "1";
}

/**
 * Operator opt-in env var that allows {@link runInWorker} to execute on Bun
 * despite the lack of permission isolation. Read via {@link getHostEnv} so that
 * a per-request project env overlay cannot enable unsafe execution from inside
 * a tenant context.
 *
 * @internal Exported for testing.
 */
export const BUN_SANDBOX_ALLOW_UNSAFE_ENV = "VERYFRONT_BUN_SANDBOX_ALLOW_UNSAFE";

/**
 * Pure decision helper for the Bun sandbox guard. Given the raw env-var
 * value, decide whether to block execution on Bun.
 *
 * Returns `true` only when the value is the literal string `"1"`. Any other
 * value (including `"true"`, `"yes"`, whitespace, or empty string) keeps the
 * guard active. Strict equality is intentional for a security opt-in.
 *
 * @internal Exported for testing only.
 */
export function isBunSandboxAllowedUnsafe(envValue: string | undefined): boolean {
  return envValue === "1";
}

/**
 * Run untrusted JavaScript in an isolated Worker.
 *
 * ## Isolation model
 *
 * - **Deno (recommended):** the worker is spawned with `permissions: "none"`,
 *   denying filesystem, network, env, and subprocess access. This is the
 *   primary safe execution path.
 * - **Node.js:** Node Workers do not support permission isolation. They
 *   inherit full access to the filesystem, network, env vars, and built-in
 *   modules. Only memory limits can be enforced. Because of this, the Node
 *   path is **disabled by default** and throws {@link NOT_SUPPORTED}.
 *   Operators who deliberately trust their input may set the env var
 *   `VERYFRONT_NODE_SANDBOX_ALLOW_UNSAFE=1` to bypass the guard.
 * - **Bun:** Bun Workers have the same lack of permission isolation as Node.js.
 *   The Bun path is **disabled by default** and throws {@link NOT_SUPPORTED}.
 *   Operators who deliberately trust their input may set the env var
 *   `VERYFRONT_BUN_SANDBOX_ALLOW_UNSAFE=1` to bypass the guard.
 *
 * Callers SHOULD NOT pass untrusted code to this function on Node.js or Bun
 * unless they have audited every caller and operator and accept the risk.
 *
 * @throws NOT_SUPPORTED on Node.js without the explicit opt-in env var.
 * @throws NOT_SUPPORTED on Bun without the explicit opt-in env var.
 */
export function runInWorker<T = unknown>(code: string, options: SandboxOptions = {}): Promise<T> {
  if (typeof code !== "string") {
    return Promise.reject(INVALID_ARGUMENT.create({ message: "Sandbox code must be a string" }));
  }
  if (code.length === 0) {
    return Promise.reject(INVALID_ARGUMENT.create({ message: "Sandbox code cannot be empty" }));
  }
  const codeByteLength = new TextEncoder().encode(code).byteLength;
  if (codeByteLength > MAX_SANDBOX_CODE_SIZE) {
    return Promise.reject(INVALID_ARGUMENT.create({
      message: `Sandbox code exceeds maximum size (${MAX_SANDBOX_CODE_SIZE} bytes)`,
    }));
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_SANDBOX_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(INVALID_ARGUMENT.create({
      message: "Sandbox timeoutMs must be a positive safe integer",
    }));
  }
  if (
    options.memoryLimitMb !== undefined &&
    (!Number.isSafeInteger(options.memoryLimitMb) || options.memoryLimitMb <= 0)
  ) {
    return Promise.reject(INVALID_ARGUMENT.create({
      message: "Sandbox memoryLimitMb must be a positive safe integer",
    }));
  }

  // SEC-008: Node Workers have no permission isolation. Refuse execution
  // unless the operator has explicitly opted in via host env var. Use
  // getHostEnv so a tenant project env overlay cannot enable this.
  if (isNode && !isNodeSandboxAllowedUnsafe(getHostEnv(NODE_SANDBOX_ALLOW_UNSAFE_ENV))) {
    return Promise.reject(NOT_SUPPORTED.create({
      detail: "Sandbox execution is not safely supported on Node.js. The current " +
        "implementation provides only memory limits, not permission isolation. " +
        "Set VERYFRONT_NODE_SANDBOX_ALLOW_UNSAFE=1 to enable execution at your " +
        "own risk, or run under Deno for full isolation.",
    }));
  }

  // SEC-008: Bun Workers have no permission isolation (same risk as Node.js).
  // Refuse execution unless the operator has explicitly opted in via host env
  // var. Use getHostEnv so a tenant project env overlay cannot enable this.
  if (isBun && !isBunSandboxAllowedUnsafe(getHostEnv(BUN_SANDBOX_ALLOW_UNSAFE_ENV))) {
    return Promise.reject(NOT_SUPPORTED.create({
      detail: "Sandbox execution is not safely supported on Bun. The current " +
        "implementation provides no permission isolation. " +
        "Set VERYFRONT_BUN_SANDBOX_ALLOW_UNSAFE=1 to enable execution at your " +
        "own risk, or run under Deno for full isolation.",
    }));
  }

  return withSpan(
    "security.sandbox.runInWorker",
    () => {
      const workerOptions: ExtendedWorkerOptions = { type: "module" };

      if (isDeno) workerOptions.deno = { permissions: "none" };

      const { memoryLimitMb } = options;
      if (typeof memoryLimitMb === "number") {
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
      const objectUrl = isCompiledBinary()
        ? null
        : URL.createObjectURL(new Blob([workerCode], { type: "application/javascript" }));
      const workerUrl = objectUrl ?? `data:text/javascript;base64,${btoa(workerCode)}`;

      let objectUrlRevoked = false;
      function revokeObjectUrl(): void {
        if (!objectUrl || objectUrlRevoked) return;
        objectUrlRevoked = true;
        URL.revokeObjectURL(objectUrl);
      }

      let worker: Worker;
      try {
        worker = new Worker(workerUrl, workerOptions);
      } catch (error) {
        revokeObjectUrl();
        throw error;
      }

      function safeTerminate(logMessage: string): void {
        try {
          worker.terminate();
        } catch {
          serverLogger.debug(logMessage);
        } finally {
          revokeObjectUrl();
        }
      }

      const promise = new Promise<T>((resolve, reject) => {
        let settled = false;
        const settle = (operation: () => void): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          operation();
          safeTerminate("[sandbox] worker terminate failed");
        };
        const timer = setTimeout(() => {
          settle(() => reject(TIMEOUT_ERROR.create({ detail: "Sandbox timeout" })));
        }, timeoutMs);

        worker.onmessage = (e: MessageEvent) => {
          const { result, error } = e.data ?? {};
          settle(() => {
            if (error) reject(UNKNOWN_ERROR.create({ detail: error }));
            else resolve(result as T);
          });
        };

        worker.onerror = (e) => {
          e.preventDefault();
          settle(() =>
            reject(
              UNKNOWN_ERROR.create({ detail: String(e.message || e.error || "Worker error") }),
            )
          );
        };

        try {
          worker.postMessage({ code });
        } catch (error) {
          settle(() => reject(error));
        }
      });

      return promise;
    },
    {
      "sandbox.timeoutMs": timeoutMs,
      "sandbox.memoryLimitMb": options.memoryLimitMb ?? 0,
    },
  );
}
