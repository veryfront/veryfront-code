import { tryResolve } from "#veryfront/extensions/contracts.ts";
import type { NodeCompat } from "#veryfront/extensions/compat/node-compat.ts";

/**
 * Extracts plain text from various upload formats.
 *
 * Text and CSV are handled inline (CSV uses a RAG-optimized format that
 * denormalizes headers into every row). All other formats (PDF, DOCX, XLSX,
 * PPTX, HTML, RTF, EPUB, etc.) are delegated to the `NodeCompat` extension
 * contract, which owns kreuzberg and the Worker isolation on Deno.
 *
 * @example
 * ```ts
 * const text = await loadUpload(buffer, "application/pdf");
 * ```
 */
export async function loadUpload(buffer: ArrayBuffer, mimeType: string): Promise<string> {
  // CSV gets RAG-optimized formatting (headers denormalized into every row)
  if (mimeType === "text/csv" || mimeType === "application/csv") {
    return extractCSV(buffer);
  }

  // Plain text and markdown — no extraction needed
  if (
    mimeType === "text/plain" ||
    mimeType === "text/markdown" ||
    mimeType === "text/mdx"
  ) {
    return new TextDecoder().decode(buffer);
  }

  // Everything else (PDF, DOCX, XLSX, PPTX, HTML, XML, etc.) → NodeCompat.
  // Synchronous registry check so the missing-extension error surfaces
  // directly from `loadUpload()` rather than through a spawned Worker.
  const nodeCompat = tryResolve<NodeCompat>("NodeCompat");
  if (!nodeCompat?.extractInWorker) {
    throw new Error(
      "Document extraction requires the NodeCompat extension. " +
        "Install @veryfront/ext-node-compatibility and add it to your extensions configuration.",
    );
  }
  return nodeCompat.extractInWorker(buffer, mimeType);
}

function extractCSV(buffer: ArrayBuffer): string {
  const text = new TextDecoder().decode(buffer);
  const lines = text.split("\n").filter((line) => line.trim());
  if (lines.length < 2) return text;

  const headers = parseCSVLine(lines[0] ?? "");
  const rows = lines.slice(1).map((line) => {
    const values = parseCSVLine(line);
    return headers
      .map((header, i) => `${header}: ${values[i] ?? ""}`)
      .join(", ");
  });

  return rows.join("\n");
}

function parseCSVLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    if (char === '"') {
      // RFC 4180: doubled quote inside a quoted field is a literal quote
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++; // skip the second quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}
