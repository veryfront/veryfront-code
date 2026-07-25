import { tryResolve } from "#veryfront/extensions/contracts.ts";
import type { DocumentExtractor } from "#veryfront/extensions/compat/native-services.ts";
import { INITIALIZATION_ERROR } from "#veryfront/errors";
import { waitWithAbort } from "./admission.ts";
import { MAX_RAG_DOCUMENT_TEXT_BYTES, requirePositiveSafeInteger } from "./validation.ts";

const DEFAULT_MAX_INPUT_BYTES = 10 * 1024 * 1024;
const MAX_CONFIGURED_UPLOAD_BYTES = 100 * 1024 * 1024;
const MAX_CSV_RECORDS = 100_000;
const MAX_CSV_COLUMNS = 1_000;
const MAX_CSV_FIELD_BYTES = 1024 * 1024;

/** Options controlling upload extraction resource use and cancellation. */
export interface UploadLoadOptions {
  /** Abort document extraction when the caller no longer needs the result. */
  abortSignal?: AbortSignal;
  /** Maximum source bytes accepted before extraction. Defaults to 10 MiB. */
  maxInputBytes?: number;
  /** Maximum UTF-8 bytes returned after extraction. Defaults to the RAG document limit. */
  maxOutputBytes?: number;
}

export type UploadContentErrorCode =
  | "input-too-large"
  | "invalid-content"
  | "output-too-large";

/** A safe, client-actionable failure caused by malformed or oversized content. */
export class UploadContentError extends Error {
  override readonly name = "UploadContentError";

  constructor(
    message: string,
    readonly code: UploadContentErrorCode = "invalid-content",
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/**
 * Extracts embedding-ready text or Markdown from upload formats.
 *
 * Text and CSV are handled inline (CSV uses a RAG-optimized format that
 * denormalizes headers into every row). All other formats (PDF, DOCX, XLSX,
 * PPTX, HTML, RTF, EPUB, etc.) are delegated to the `DocumentExtractor`
 * extension contract, which owns kreuzberg, Markdown extraction, and Worker
 * isolation on Deno. Input and UTF-8 output are bounded, malformed UTF-8 and
 * CSV are rejected, and `abortSignal` is propagated into extraction workers.
 *
 * @example
 * ```ts
 * const markdown = await loadUpload(buffer, "application/pdf");
 * ```
 */
export async function loadUpload(
  buffer: ArrayBuffer,
  mimeType: string,
  options: UploadLoadOptions = {},
): Promise<string> {
  const maxInputBytes = requirePositiveSafeInteger(
    options.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES,
    "loadUpload maxInputBytes",
    MAX_CONFIGURED_UPLOAD_BYTES,
  );
  const maxOutputBytes = requirePositiveSafeInteger(
    options.maxOutputBytes ?? MAX_RAG_DOCUMENT_TEXT_BYTES,
    "loadUpload maxOutputBytes",
    MAX_CONFIGURED_UPLOAD_BYTES,
  );
  options.abortSignal?.throwIfAborted();
  if (buffer.byteLength > maxInputBytes) {
    throw new UploadContentError(
      `Upload source exceeds the configured ${maxInputBytes}-byte limit`,
      "input-too-large",
    );
  }
  const { baseType, charset } = parseMimeType(mimeType);

  // CSV gets RAG-optimized formatting (headers denormalized into every row)
  if (baseType === "text/csv" || baseType === "application/csv") {
    assertSupportedTextCharset(charset);
    return extractCSV(buffer, maxOutputBytes, options.abortSignal);
  }

  // Plain text and markdown, no extraction needed.
  if (
    baseType === "text/plain" ||
    baseType === "text/markdown" ||
    baseType === "text/mdx"
  ) {
    assertSupportedTextCharset(charset);
    return enforceOutputLimit(
      decodeUtf8(buffer),
      maxOutputBytes,
    );
  }

  // Everything else (PDF, DOCX, XLSX, PPTX, HTML, XML, etc.) uses DocumentExtractor.
  // Synchronous registry check so the missing-extension error surfaces
  // directly from `loadUpload()` rather than through a spawned Worker.
  const extractor = tryResolve<DocumentExtractor>("DocumentExtractor");
  if (!extractor?.extractInWorker) {
    throw INITIALIZATION_ERROR.create({
      detail: "Document extraction requires a DocumentExtractor extension. " +
        "Install @veryfront/ext-document-kreuzberg and add it to your extensions configuration.",
    });
  }
  const extracted = await waitWithAbort(
    extractor.extractInWorker(buffer, baseType, {
      abortSignal: options.abortSignal,
    }),
    options.abortSignal,
  );
  options.abortSignal?.throwIfAborted();
  if (typeof extracted !== "string") {
    throw new UploadContentError("Document extractor returned invalid text", "invalid-content");
  }
  return enforceOutputLimit(extracted, maxOutputBytes);
}

function extractCSV(
  buffer: ArrayBuffer,
  maxOutputBytes: number,
  abortSignal?: AbortSignal,
): string {
  const text = decodeUtf8(buffer);
  abortSignal?.throwIfAborted();
  let headers: string[] | undefined;
  const output: string[] = [];
  let outputBytes = 0;

  for (const record of parseCSVRecords(text, abortSignal)) {
    const values = record.map((value) => value.trim());
    if (values.every((value) => value.length === 0)) continue;
    if (!headers) {
      if (values.some((value) => value.length === 0)) {
        throw new UploadContentError("Malformed CSV: header names must not be empty");
      }
      if (new Set(values).size !== values.length) {
        throw new UploadContentError("Malformed CSV: header names must be unique");
      }
      headers = values;
      continue;
    }
    if (values.length > headers.length) {
      throw new UploadContentError(
        `Malformed CSV: record has ${values.length} values for ${headers.length} headers`,
      );
    }

    const row = headers
      .map((header, index) => `${renderCSVField(header)}: ${renderCSVField(values[index] ?? "")}`)
      .join(", ");
    const part = output.length === 0 ? row : `\n${row}`;
    outputBytes += utf8LengthWithinLimit(
      part,
      maxOutputBytes - outputBytes,
      maxOutputBytes,
    );
    output.push(part);
  }

  if (!headers || output.length === 0) {
    return enforceOutputLimit(text, maxOutputBytes);
  }
  return output.join("");
}

function* parseCSVRecords(
  text: string,
  abortSignal?: AbortSignal,
): Generator<string[]> {
  let record: string[] = [];
  let current = "";
  let state: "after-quote" | "quoted" | "unquoted" = "unquoted";
  let recordStarted = false;
  let recordCount = 0;

  for (let index = 0; index < text.length; index++) {
    if ((index & 0xfff) === 0) abortSignal?.throwIfAborted();
    const char = text[index]!;

    if (state === "quoted") {
      if (char === '"' && text[index + 1] === '"') {
        current += '"';
        index++;
      } else if (char === '"') {
        state = "after-quote";
      } else if (char === "\r") {
        if (text[index + 1] === "\n") index++;
        current += "\n";
      } else {
        current += char;
      }
      recordStarted = true;
      assertCSVFieldSize(current);
      continue;
    }

    if (state === "after-quote") {
      if (char === ",") {
        pushCSVField(record, current);
        current = "";
        state = "unquoted";
        recordStarted = true;
        continue;
      }
      if (char === "\n" || char === "\r") {
        if (char === "\r" && text[index + 1] === "\n") index++;
        pushCSVField(record, current);
        yield boundedCSVRecord(record, ++recordCount);
        record = [];
        current = "";
        state = "unquoted";
        recordStarted = false;
        continue;
      }
      if (char === " " || char === "\t") continue;
      throw new UploadContentError(
        `Malformed CSV: unexpected character after closing quote in record ${recordCount + 1}`,
      );
    }

    if (char === '"' && current.trim().length === 0) {
      current = "";
      state = "quoted";
      recordStarted = true;
    } else if (char === '"') {
      throw new UploadContentError(
        `Malformed CSV: quote inside an unquoted field in record ${recordCount + 1}`,
      );
    } else if (char === ",") {
      pushCSVField(record, current);
      current = "";
      recordStarted = true;
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index++;
      pushCSVField(record, current);
      yield boundedCSVRecord(record, ++recordCount);
      record = [];
      current = "";
      recordStarted = false;
    } else {
      current += char;
      recordStarted = true;
      assertCSVFieldSize(current);
    }
  }

  if (state === "quoted") {
    throw new UploadContentError("Malformed CSV: unterminated quoted field");
  }
  if (recordStarted || record.length > 0) {
    pushCSVField(record, current);
    yield boundedCSVRecord(record, ++recordCount);
  }
}

function enforceOutputLimit(text: string, maxOutputBytes: number): string {
  utf8LengthWithinLimit(text, maxOutputBytes, maxOutputBytes);
  return text;
}

function utf8LengthWithinLimit(
  text: string,
  remainingBytes: number,
  maxOutputBytes: number,
): number {
  if (remainingBytes < 0 || text.length > remainingBytes) {
    throw new UploadContentError(
      `Extracted upload text exceeds the configured ${maxOutputBytes}-byte limit`,
      "output-too-large",
    );
  }
  const byteLength = new TextEncoder().encode(text).byteLength;
  if (byteLength > remainingBytes) {
    throw new UploadContentError(
      `Extracted upload text exceeds the configured ${maxOutputBytes}-byte limit`,
      "output-too-large",
    );
  }
  return byteLength;
}

function parseMimeType(mimeType: string): { baseType: string; charset?: string } {
  if (typeof mimeType !== "string") {
    throw new UploadContentError("Upload MIME type must be a string");
  }
  const [rawBaseType = "", ...parameters] = mimeType.split(";");
  const baseType = rawBaseType.trim().toLowerCase();
  if (!baseType || !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(baseType)) {
    throw new UploadContentError("Upload MIME type is invalid");
  }

  let charset: string | undefined;
  for (const parameter of parameters) {
    const separator = parameter.indexOf("=");
    if (separator < 0) continue;
    const name = parameter.slice(0, separator).trim().toLowerCase();
    if (name !== "charset") continue;
    charset = parameter.slice(separator + 1).trim().replace(/^"(.*)"$/, "$1").toLowerCase();
  }
  return { baseType, charset };
}

function assertSupportedTextCharset(charset: string | undefined): void {
  if (charset === undefined || charset === "utf-8" || charset === "utf8") return;
  throw new UploadContentError(`Unsupported text charset: ${charset}`);
}

function decodeUtf8(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch (error) {
    throw new UploadContentError("Upload text is not valid UTF-8", "invalid-content", {
      cause: error,
    });
  }
}

function assertCSVFieldSize(field: string): void {
  if (field.length > MAX_CSV_FIELD_BYTES) {
    throw new UploadContentError(
      `Malformed CSV: field exceeds ${MAX_CSV_FIELD_BYTES} bytes`,
      "input-too-large",
    );
  }
}

function pushCSVField(record: string[], field: string): void {
  if (record.length >= MAX_CSV_COLUMNS) {
    throw new UploadContentError(
      `Malformed CSV: record exceeds ${MAX_CSV_COLUMNS} columns`,
      "input-too-large",
    );
  }
  assertCSVFieldSize(field);
  if (new TextEncoder().encode(field).byteLength > MAX_CSV_FIELD_BYTES) {
    throw new UploadContentError(
      `Malformed CSV: field exceeds ${MAX_CSV_FIELD_BYTES} bytes`,
      "input-too-large",
    );
  }
  record.push(field);
}

function boundedCSVRecord(record: string[], recordCount: number): string[] {
  if (recordCount > MAX_CSV_RECORDS) {
    throw new UploadContentError(
      `CSV exceeds ${MAX_CSV_RECORDS} records`,
      "input-too-large",
    );
  }
  return record;
}

function renderCSVField(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("\r\n", "\\n")
    .replaceAll("\r", "\\n")
    .replaceAll("\n", "\\n");
}
