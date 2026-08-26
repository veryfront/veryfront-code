/**
 * Native document extraction subprocess entrypoint.
 *
 * Runs the native kreuzberg parser in a separate OS process so a native abort
 * or segfault kills this process, never the host server. Deno Workers are
 * in-process isolates and cannot contain native crashes, which is why the host
 * spawns this script via `deno run` instead of a Worker.
 *
 * Protocol:
 * - argv: `<mimeType> <whole-file|progress>`
 * - stdin: the raw document bytes
 * - stdout: NDJSON lines — `{"type":"progress",...}`, then one final
 *   `{"type":"done","content":...}` or `{"type":"error","error":...}`
 *
 * @module extensions/ext-document-kreuzberg/native-extraction-process
 */

import { extractNativeDocument, type NativeExtractionMode } from "./native-extraction.ts";

const encoder = new TextEncoder();

function emit(message: unknown): void {
  const bytes = encoder.encode(`${JSON.stringify(message)}\n`);
  let written = 0;
  while (written < bytes.length) {
    written += Deno.stdout.writeSync(bytes.subarray(written));
  }
}

const [mimeType, mode] = Deno.args;

if (!mimeType || (mode !== "whole-file" && mode !== "progress")) {
  emit({
    type: "error",
    error: "usage: native-extraction-process <mimeType> <whole-file|progress>",
  });
  Deno.exit(2);
}

try {
  const bytes = await new Response(Deno.stdin.readable).bytes();
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const content = await extractNativeDocument(buffer, mimeType, {
    mode: mode as NativeExtractionMode,
    emitProgress: (event) => emit({ type: "progress", event }),
  });
  emit({ type: "done", content });
  Deno.exit(0);
} catch (error) {
  emit({
    type: "error",
    error: error instanceof Error ? error.message : String(error),
  });
  Deno.exit(1);
}
