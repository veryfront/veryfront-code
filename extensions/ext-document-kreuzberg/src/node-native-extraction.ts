/** Contain native parser crashes and cancellation in a Node/Bun OS child. */
import { spawn } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";
import type {
  DocumentExtractionOptions,
  DocumentExtractionProgressEvent,
} from "veryfront/extensions/compat";
import type { NativeExtractionMode } from "./native-extraction.ts";

export interface NodeExtractionProcessOverrides {
  execPath?: string;
  scriptUrl?: URL;
}

function progressEvent(value: unknown): DocumentExtractionProgressEvent | undefined {
  if (typeof value !== "object" || value === null || !("unit" in value) || !("current" in value)) {
    return undefined;
  }
  if (
    (value.unit !== "page" && value.unit !== "slide" && value.unit !== "file") ||
    typeof value.current !== "number" || !Number.isFinite(value.current)
  ) return undefined;
  const total = "total" in value ? value.total : undefined;
  const characters = "characters" in value ? value.characters : undefined;
  if (
    (total !== undefined && (typeof total !== "number" || !Number.isFinite(total))) ||
    (characters !== undefined && (typeof characters !== "number" || !Number.isFinite(characters)))
  ) return undefined;
  return {
    unit: value.unit,
    current: value.current,
    ...(total === undefined ? {} : { total }),
    ...(characters === undefined ? {} : { characters }),
  };
}

export async function extractWithNativeProcessNode(
  buffer: ArrayBuffer,
  mimeType: string,
  options: DocumentExtractionOptions,
  mode: NativeExtractionMode,
  overrides: NodeExtractionProcessOverrides = {},
): Promise<string> {
  options.signal?.throwIfAborted();
  const scriptFile = import.meta.url.endsWith(".ts")
    ? "./node-native-extraction-process.ts"
    : "./node-native-extraction-process.js";
  const scriptUrl = overrides.scriptUrl ?? new URL(scriptFile, import.meta.url);
  if (scriptUrl.protocol !== "file:") {
    throw new Error("Native extraction subprocess script is not on disk");
  }
  const child = spawn(overrides.execPath ?? process.execPath, [
    fileURLToPath(scriptUrl),
    mimeType,
    mode,
  ], {
    stdio: ["pipe", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  let error: unknown;
  let failed = false;
  let content: string | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let notifyStop: () => void = () => {};
  const stopped = new Promise<void>((resolve) => {
    notifyStop = resolve;
  });
  let termination: Promise<void> = Promise.resolve();
  let killing = false;
  const kill = () => {
    if (killing) return;
    killing = true;
    try {
      if (process.platform !== "win32" && child.pid !== undefined) {
        process.kill(-child.pid, "SIGKILL");
      } else if (child.pid !== undefined) {
        const taskkill = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
        });
        termination = new Promise<void>((resolve) => {
          taskkill.once("error", () => {
            child.kill("SIGKILL");
            resolve();
          });
          taskkill.once("close", (code) => {
            if (code !== 0) child.kill("SIGKILL");
            resolve();
          });
        });
      } else child.kill("SIGKILL");
    } catch { /* Child already exited. */ }
  };
  const fail = (reason: unknown) => {
    if (!failed) {
      failed = true;
      error = reason;
    }
    kill();
    notifyStop();
  };
  const onAbort = () => fail(options.signal?.reason);
  options.signal?.addEventListener("abort", onAbort, { once: true });
  if (options.signal?.aborted) onAbort();
  const resetIdle = () => {
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    if (mode === "progress") {
      idleTimer = setTimeout(
        () => fail(new Error("Text extraction made no progress")),
        options.idleTimeoutMs ?? 120_000,
      );
    }
  };
  const hardTimer = setTimeout(
    () => fail(new Error("Text extraction exceeded the hard timeout")),
    options.hardTimeoutMs ?? 600_000,
  );
  const closed = new Promise<void>((resolve) => {
    child.once("error", (reason) => {
      fail(reason);
    });
    child.once("close", (code, signal) => {
      if (!failed && code !== 0) {
        failed = true;
        error = new Error(`Native extraction process exited (code ${code}, signal ${signal})`);
      }
      resolve();
    });
  });
  // Diagnostics can contain private filesystem paths. Drain without publishing.
  const stderr = (async () => {
    for await (const _chunk of child.stderr) { /* drain */ }
  })().catch(fail);
  child.stdin.on("error", (reason) => {
    if (!failed) fail(reason);
  });
  child.stdin.end(new Uint8Array(buffer));
  try {
    resetIdle();
    let pending = "";
    const decoder = new TextDecoder();
    for await (const chunk of child.stdout) {
      pending += decoder.decode(chunk, { stream: true });
      let newline = pending.indexOf("\n");
      while (newline >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        newline = pending.indexOf("\n");
        if (!line || failed) continue;
        let message: unknown;
        try {
          message = JSON.parse(line);
        } catch {
          fail(new Error("Invalid native extraction protocol"));
          break;
        }
        if (
          typeof message !== "object" || message === null || !("type" in message) ||
          content !== undefined
        ) {
          fail(new Error("Invalid or repeated native extraction protocol"));
          break;
        }
        if (
          message.type === "done" && "content" in message && typeof message.content === "string"
        ) content = message.content;
        else if (message.type === "error") fail(new Error("Native document extraction failed"));
        else if (message.type === "progress" && "event" in message) {
          const event = progressEvent(message.event);
          if (!event) {
            fail(new Error("Invalid native extraction progress"));
            break;
          }
          if (idleTimer !== undefined) clearTimeout(idleTimer);
          const delivered = Promise.resolve().then(() => options.onProgress?.(event)).catch(fail);
          await Promise.race([delivered, stopped]);
          if (!failed) resetIdle();
        } else fail(new Error("Unknown native extraction protocol message"));
      }
    }
    if (pending.trim() && !failed) fail(new Error("Incomplete native extraction protocol"));
    await closed;
    await termination;
    await stderr;
    options.signal?.throwIfAborted();
    if (failed) throw error;
    if (content === undefined) throw new Error("Native extraction process returned no result");
    return content;
  } catch (reason) {
    fail(reason);
    await closed;
    await termination;
    await stderr.catch(() => {});
    options.signal?.throwIfAborted();
    throw reason;
  } finally {
    clearTimeout(hardTimer);
    if (idleTimer !== undefined) clearTimeout(idleTimer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}
