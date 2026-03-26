import { serverLogger } from "#veryfront/utils";

/** Maximum time to wait for document text extraction before aborting. */
const EXTRACTION_TIMEOUT_MS = 30_000;

/**
 * Extracts plain text from various upload formats.
 *
 * Text and CSV are handled inline (CSV uses a RAG-optimized format that
 * denormalizes headers into every row). All other formats (PDF, DOCX, XLSX,
 * PPTX, HTML, RTF, EPUB, etc.) are delegated to kreuzberg for extraction
 * inside a Worker thread so that hung WASM calls cannot block the server.
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

  // Everything else (PDF, DOCX, XLSX, PPTX, HTML, XML, etc.) → kreuzberg
  // Run in a Worker thread to prevent hung WASM from blocking the server.
  return extractInWorker(buffer, mimeType);
}

function extractInWorker(buffer: ArrayBuffer, mimeType: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const workerUrl = new URL("./upload-extraction-worker.ts", import.meta.url);
    const worker = new Worker(workerUrl, { type: "module" });

    const timer = setTimeout(() => {
      worker.terminate();
      reject(
        new Error(
          `Text extraction timed out after ${
            EXTRACTION_TIMEOUT_MS / 1000
          }s — the file may be corrupted or unsupported`,
        ),
      );
    }, EXTRACTION_TIMEOUT_MS);

    worker.onmessage = (event: MessageEvent) => {
      clearTimeout(timer);
      worker.terminate();
      const { content, error } = event.data;
      if (error) {
        reject(new Error(error));
      } else {
        resolve(content);
      }
    };

    worker.onerror = (event) => {
      clearTimeout(timer);
      worker.terminate();
      serverLogger.error("[upload-loader] Worker error:", event);
      reject(new Error("Text extraction worker failed"));
    };

    worker.postMessage({ buffer, mimeType }, [buffer]);
  });
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
