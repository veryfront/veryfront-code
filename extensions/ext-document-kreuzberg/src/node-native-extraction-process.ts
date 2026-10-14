/** Native extraction child entry for Node and Bun; stdin bytes, stdout NDJSON. */
import process from "node:process";
import { Buffer } from "node:buffer";
import { extractNativeDocument } from "./native-extraction.ts";

function emit(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}
const [mimeType, mode] = process.argv.slice(2);
if (!mimeType || (mode !== "whole-file" && mode !== "progress")) {
  emit({ type: "error", error: "Invalid document extraction arguments" });
  process.exitCode = 2;
} else {
  try {
    const chunks: Uint8Array[] = [];
    for await (const chunk of process.stdin) chunks.push(new Uint8Array(chunk));
    const bytes = Buffer.concat(chunks);
    const buffer = new Uint8Array(bytes).buffer;
    const content = await extractNativeDocument(buffer, mimeType, {
      mode,
      emitProgress: emitProgress,
    });
    emit({ type: "done", content });
  } catch (error) {
    emit({ type: "error", error: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
  }
}
function emitProgress(event: unknown): void {
  emit({ type: "progress", event });
}
