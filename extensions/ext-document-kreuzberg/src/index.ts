/**
 * ext-document-kreuzberg: document text extraction for Veryfront.
 *
 * Provides the `DocumentExtractor` contract via kreuzberg. Deno extraction
 * runs the native parser in a separate `deno run` subprocess (a Worker is an
 * in-process isolate, so it cannot contain native crashes) and falls back to
 * an isolated WASM Worker whose failures stay inside the isolate.
 *
 * @module extensions/ext-document-kreuzberg
 */

import type { ExtensionFactory, ExtensionLogger } from "veryfront/extensions";
import type {
  DocumentExtractionOptions,
  DocumentExtractionProgressEvent,
  DocumentExtractor,
  KreuzbergExtractor,
} from "veryfront/extensions/compat";
import { loadKreuzberg } from "./kreuzberg.ts";
import { extractionConfigForMimeType } from "./extraction-config.ts";
import { isDeno } from "./runtime.ts";

export const NATIVE_PROGRESS_IDLE_TIMEOUT_MS = 120_000;
export const NATIVE_PROGRESS_HARD_TIMEOUT_MS = 10 * 60_000;
/** Maximum time to wait for fallback worker extraction before aborting. */
export const EXTRACTION_TIMEOUT_MS = NATIVE_PROGRESS_HARD_TIMEOUT_MS;

/**
 * How the native extraction subprocess should parse the document. Mirrors
 * `NativeExtractionMode` in `./native-extraction.ts`, duplicated here so the
 * npm build keeps the subprocess module out of the package entry graph.
 */
export type NativeExtractionMode = "whole-file" | "progress";

function extractInWorkerDeno(
  buffer: ArrayBuffer,
  mimeType: string,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    // The worker ships as raw TypeScript in the compiled binary and from source
    // (where `compile-binary.ts` force-includes it), but as transpiled JS in the
    // npm package consumed via `deno run npm:veryfront`. Pick the sibling that
    // matches whichever build is executing this module.
    const workerFile = import.meta.url.endsWith(".ts")
      ? "./upload-extraction-worker.ts"
      : "./upload-extraction-worker.js";
    const workerUrl = new URL(workerFile, import.meta.url);
    const worker = new Worker(workerUrl, { type: "module" });

    const timer = setTimeout(() => {
      worker.terminate();
      reject(
        new Error(
          `Text extraction timed out after ${
            EXTRACTION_TIMEOUT_MS / 1000
          }s. The file may be corrupted or unsupported`,
        ),
      );
    }, EXTRACTION_TIMEOUT_MS);

    worker.onmessage = (event: MessageEvent) => {
      clearTimeout(timer);
      worker.terminate();
      const { content, error } = event.data as { content?: string; error?: string };
      if (error) {
        reject(new Error(error));
      } else {
        resolve(content ?? "");
      }
    };

    worker.onerror = (event) => {
      clearTimeout(timer);
      worker.terminate();
      reject(new Error(`Text extraction worker failed: ${event.message ?? "unknown"}`));
    };

    worker.postMessage({ buffer, mimeType }, [buffer]);
  });
}

export interface KreuzbergDocumentExtractorDeps {
  isDenoRuntime?: boolean;
  extractInWorkerDeno?: typeof extractInWorkerDeno;
  extractWithNativeProcessDeno?: typeof extractWithNativeProcessDeno;
  /**
   * @deprecated Compatibility seam from the pre-subprocess API. Used only for
   * whole-file native extraction when `extractWithNativeProcessDeno` is not
   * injected. Prefer `extractWithNativeProcessDeno`.
   */
  loadNativeKreuzberg?: () => Promise<KreuzbergExtractor>;
  /**
   * @deprecated Compatibility seam from the pre-subprocess API. Used only for
   * progress extraction when `extractWithNativeProcessDeno` is not injected.
   * Prefer `extractWithNativeProcessDeno`.
   */
  extractWithNativeProgressDeno?: (
    buffer: ArrayBuffer,
    mimeType: string,
    options: DocumentExtractionOptions,
  ) => Promise<string>;
  logger?: Pick<ExtensionLogger, "warn">;
}

function isPdfMimeType(mimeType: string): boolean {
  return mimeType.toLowerCase().split(";")[0]?.trim() === "application/pdf";
}

function normalizeMimeType(mimeType: string): string {
  return mimeType.toLowerCase().split(";")[0]?.trim() ?? "";
}

function isNativeProgressMimeType(mimeType: string): boolean {
  const normalized = normalizeMimeType(mimeType);
  return normalized === "application/pdf" ||
    normalized === "application/vnd.ms-powerpoint" ||
    normalized === "application/vnd.openxmlformats-officedocument.presentationml.presentation";
}

type NativeProcessMessage =
  | { type: "done"; content: string }
  | { type: "error"; error: string }
  | { type: "progress"; event: DocumentExtractionProgressEvent };

function warningDetails(mimeType: string, error: unknown): Record<string, string> {
  return {
    mimeType,
    error: error instanceof Error ? error.message : String(error),
  };
}

function nativeExtractionProcessScriptUrl(): URL {
  // Same raw-TS vs transpiled-JS sibling dance as the Worker above.
  const scriptFile = import.meta.url.endsWith(".ts")
    ? "./native-extraction-process.ts"
    : "./native-extraction-process.js";
  return new URL(scriptFile, import.meta.url);
}

function denoExecutableForSubprocess(): string {
  const execPath = Deno.execPath();
  const name = execPath.split(/[/\\]/).pop()?.toLowerCase() ?? "";
  if (name !== "deno" && name !== "deno.exe") {
    throw new Error(
      "Native extraction subprocess unavailable: not running under the deno CLI " +
        "(compiled binaries fall back to isolated WASM extraction)",
    );
  }
  return execPath;
}

async function readBoundedText(
  stream: ReadableStream<Uint8Array>,
  limit = 4096,
): Promise<string> {
  let text = "";
  const decoder = new TextDecoder();
  try {
    for await (const chunk of stream) {
      // Keep consuming to EOF so the child never blocks on a full pipe.
      if (text.length < limit) text += decoder.decode(chunk, { stream: true });
    }
  } catch {
    // Diagnostics only — a broken stderr stream is not fatal.
  }
  return text.slice(0, limit);
}

/**
 * Reduce subprocess stderr or protocol errors to a stable, redacted failure
 * summary. Native diagnostics commonly contain absolute cache or home paths
 * and stack traces. Keep the first meaningful line, drop stack frames, and
 * replace path-like tokens with a placeholder.
 */
function sanitizeNativeProcessDiagnostic(diagnostic: string): string {
  const line = diagnostic
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0 && !entry.startsWith("at "));
  if (!line) return "";
  return line
    .replace(/(?:file:\/\/)?(?:[A-Za-z]:)?(?:[\\/][^\s"':,)]+){2,}[\\/]?/g, "<REDACTED>")
    .slice(0, 256);
}

/** Test seams for the native extraction subprocess. */
export interface NativeExtractionProcessOverrides {
  execPath?: string;
  scriptUrl?: URL;
  /** Injected subprocess used by lifecycle tests. */
  child?: Deno.ChildProcess;
}

/**
 * Run native kreuzberg extraction in a separate `deno run` subprocess.
 *
 * A subprocess — not a Worker — is required for containment: Deno Workers are
 * isolates inside the host process, so a native abort/segfault in
 * `@kreuzberg/node` would kill the server before `onerror` or any timeout
 * fires. A crashing subprocess only closes its pipes; the host survives,
 * observes the exit status, and falls back to WASM extraction.
 */
export async function extractWithNativeProcessDeno(
  buffer: ArrayBuffer,
  mimeType: string,
  options: DocumentExtractionOptions,
  mode: NativeExtractionMode,
  overrides: NativeExtractionProcessOverrides = {},
): Promise<string> {
  const scriptUrl = overrides.scriptUrl ?? nativeExtractionProcessScriptUrl();
  if (scriptUrl.protocol !== "file:") {
    throw new Error(
      "Native extraction subprocess unavailable: extraction script is not on disk",
    );
  }
  const execPath = overrides.execPath ?? denoExecutableForSubprocess();

  const idleTimeoutMs = options.idleTimeoutMs ?? NATIVE_PROGRESS_IDLE_TIMEOUT_MS;
  const hardTimeoutMs = options.hardTimeoutMs ?? NATIVE_PROGRESS_HARD_TIMEOUT_MS;

  // Least privilege: the parser needs to read module/FFI files, consult env
  // for module resolution, and load the native binding. No net, run, or write.
  // Every flag below maps to a capability the extension declares (fs:read,
  // env:read, native:ffi); keep flags and declared capabilities in sync.
  const child = overrides.child ?? new Deno.Command(execPath, {
    args: [
      "run",
      "--quiet",
      "--no-prompt",
      "--allow-read",
      "--allow-env",
      "--allow-ffi",
      scriptUrl.href,
      mimeType,
      mode,
    ],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();

  let timeoutError: Error | undefined;
  let callbackError: Error | undefined;
  let childError: string | undefined;
  let content: string | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  const killChild = () => {
    try {
      child.kill("SIGKILL");
    } catch {
      // Already exited.
    }
  };
  // Settles as soon as either timer fires so progress-callback delivery can be
  // raced against timeout settlement below.
  let notifyTimeout: () => void = () => {};
  const timeoutFired = new Promise<"timeout">((resolve) => {
    notifyTimeout = () => resolve("timeout");
  });
  const failWithTimeout = (error: Error) => {
    timeoutError ??= error;
    killChild();
    notifyTimeout();
  };
  const clearIdleTimer = () => {
    if (!idleTimer) return;
    clearTimeout(idleTimer);
    idleTimer = undefined;
  };
  const resetIdleTimer = () => {
    // Whole-file mode emits nothing until the single native parse completes,
    // so an idle deadline would kill valid large documents long before the
    // advertised hard timeout. Only progress mode is expected to stay chatty.
    if (mode !== "progress") return;
    clearIdleTimer();
    idleTimer = setTimeout(() => {
      failWithTimeout(
        new Error(
          `Text extraction made no progress for ${idleTimeoutMs / 1000}s. ` +
            "The file may be corrupted or unsupported",
        ),
      );
    }, idleTimeoutMs);
  };
  const hardTimer = setTimeout(() => {
    failWithTimeout(
      new Error(
        `Text extraction exceeded the hard timeout after ${hardTimeoutMs / 1000}s. ` +
          "The file may be corrupted or unsupported",
      ),
    );
  }, hardTimeoutMs);

  const stderrPromise = readBoundedText(child.stderr);
  const stdinPromise = (async () => {
    const writer = child.stdin.getWriter();
    try {
      await writer.write(new Uint8Array(buffer));
      await writer.close();
    } catch {
      // A crashed child closes the pipe early; the exit status reports it.
    }
  })();

  try {
    try {
      resetIdleTimer();
      let pending = "";
      const stdoutDecoder = new TextDecoder();
      readLoop:
      for await (const chunk of child.stdout) {
        pending += stdoutDecoder.decode(chunk, { stream: true });
        let newlineIndex = pending.indexOf("\n");
        while (newlineIndex !== -1) {
          const line = pending.slice(0, newlineIndex).trim();
          pending = pending.slice(newlineIndex + 1);
          newlineIndex = pending.indexOf("\n");
          if (!line || callbackError) continue;

          let message: NativeProcessMessage;
          try {
            message = JSON.parse(line) as NativeProcessMessage;
          } catch {
            continue; // Ignore non-protocol output.
          }
          if (message.type === "progress") {
            clearIdleTimer();
            // Race callback delivery against timeout settlement: an async
            // onProgress that never settles must not keep this await pending
            // past the hard deadline, or hardTimeoutMs is never enforced.
            const delivery = Promise.resolve()
              .then(() => options.onProgress?.(message.event))
              .then(() => "delivered" as const, (error) => {
                callbackError ??= error instanceof Error ? error : new Error(String(error));
                return "failed" as const;
              });
            const outcome = await Promise.race([delivery, timeoutFired]);
            if (outcome === "timeout") break readLoop;
            if (outcome === "failed") {
              killChild();
              continue;
            }
            resetIdleTimer();
          } else if (message.type === "error") {
            childError ??= message.error;
          } else if (message.type === "done") {
            content ??= message.content;
          }
        }
      }
    } finally {
      // Progress cannot resume after stdout closes, but the hard deadline must
      // remain active until the child itself exits and its streams settle.
      clearIdleTimer();
    }

    // The child has closed stdout by now (normal exit, crash, or kill); await
    // everything so no process or stream leaks past this call.
    const status = await child.status;
    const stderrText = (await stderrPromise).trim();
    await stdinPromise;

    if (timeoutError) throw timeoutError;
    if (callbackError) throw callbackError;
    if (childError !== undefined) {
      throw new Error(
        sanitizeNativeProcessDiagnostic(childError) || "Native extraction process failed",
      );
    }
    if (content !== undefined) return content;

    const signalSuffix = status.signal ? `, signal ${status.signal}` : "";
    const stderrSummary = sanitizeNativeProcessDiagnostic(stderrText);
    const stderrSuffix = stderrSummary ? `: ${stderrSummary}` : "";
    throw new Error(
      `Native extraction process exited without a result (code ${status.code}${signalSuffix})${stderrSuffix}`,
    );
  } finally {
    clearIdleTimer();
    clearTimeout(hardTimer);
  }
}

async function extractWholeFileWithLoader(
  buffer: ArrayBuffer,
  mimeType: string,
  loadNative: () => Promise<KreuzbergExtractor>,
): Promise<string> {
  const { extractBytes } = await loadNative();
  const result = await extractBytes(
    new Uint8Array(buffer),
    mimeType,
    extractionConfigForMimeType(mimeType),
  );
  return result.content;
}

export class KreuzbergDocumentExtractor implements DocumentExtractor {
  constructor(private readonly deps: KreuzbergDocumentExtractorDeps = {}) {}

  importKreuzberg(): Promise<KreuzbergExtractor> {
    return loadKreuzberg();
  }

  private extractWithNative(
    buffer: ArrayBuffer,
    mimeType: string,
    options: DocumentExtractionOptions,
    mode: NativeExtractionMode,
  ): Promise<string> {
    if (this.deps.extractWithNativeProcessDeno) {
      return this.deps.extractWithNativeProcessDeno(buffer, mimeType, options, mode);
    }
    // Deprecated injection seams from the pre-subprocess API keep their old
    // behavior when the subprocess seam is not injected.
    if (mode === "progress" && this.deps.extractWithNativeProgressDeno) {
      return this.deps.extractWithNativeProgressDeno(buffer, mimeType, options);
    }
    if (mode === "whole-file" && this.deps.loadNativeKreuzberg) {
      return extractWholeFileWithLoader(buffer, mimeType, this.deps.loadNativeKreuzberg);
    }
    return extractWithNativeProcessDeno(buffer, mimeType, options, mode);
  }

  async extractInWorker(
    buffer: ArrayBuffer,
    mimeType: string,
    options: DocumentExtractionOptions = {},
  ): Promise<string> {
    const isDenoRuntime = this.deps.isDenoRuntime ?? isDeno;
    const extractWithWorker = this.deps.extractInWorkerDeno ?? extractInWorkerDeno;

    // Node/Bun extract in-process via @kreuzberg/node. Deno runs the native
    // parser behind a process boundary (Workers are in-process isolates and
    // cannot contain a native crash) with idle/hard timeouts, then falls back
    // to the isolated WASM worker. Without a progress request the subprocess
    // parses the whole file in one native pass instead of page-by-page.
    if (!isDenoRuntime) {
      const { extractBytes } = await loadKreuzberg();
      const result = await extractBytes(
        new Uint8Array(buffer),
        mimeType,
        extractionConfigForMimeType(mimeType),
      );
      return result.content;
    }

    if (
      isPdfMimeType(mimeType) ||
      (options.onProgress && isNativeProgressMimeType(mimeType))
    ) {
      const mode: NativeExtractionMode = options.onProgress ? "progress" : "whole-file";
      try {
        return await this.extractWithNative(buffer, mimeType, options, mode);
      } catch (error) {
        // Keep native extraction opportunistic: when the subprocess cannot run
        // (compiled binary, missing binding, crash), fall back to the isolated
        // WASM worker whose failures stay inside the isolate.
        const message =
          "[ext-document-kreuzberg] native process extraction failed; falling back to isolated worker extraction";
        const details = warningDetails(mimeType, error);
        if (this.deps.logger) {
          this.deps.logger.warn(message, details);
        } else {
          console.warn(message, details);
        }
      }
    }

    return extractWithWorker(buffer, mimeType);
  }
}

const extDocumentKreuzberg: ExtensionFactory = () => {
  return {
    name: "ext-document-kreuzberg",
    version: "0.1.0",
    contracts: {
      provides: ["DocumentExtractor"],
    },
    capabilities: [
      { type: "fs:read" },
      { type: "process:spawn", commands: ["deno"] },
      // The extraction subprocess runs with --allow-env and --allow-ffi: the
      // napi-rs loader in @kreuzberg/node consults the environment to resolve
      // the native binding and loads it over FFI. Declared here so the child
      // permission surface stays within the audited capability boundary.
      { type: "env:read" },
      { type: "native:ffi" },
    ],

    setup(ctx) {
      const extractor = new KreuzbergDocumentExtractor({ logger: ctx.logger });
      ctx.provide("DocumentExtractor", extractor);
      ctx.logger.debug("[ext-document-kreuzberg] document extraction registered");
    },
  };
};

export default extDocumentKreuzberg;
