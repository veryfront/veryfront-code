import { tryResolve } from "#veryfront/extensions/contracts.ts";
import type { DocumentExtractor } from "#veryfront/extensions/compat/native-services.ts";
import { INITIALIZATION_ERROR, INVALID_ARGUMENT } from "#veryfront/errors";
import {
  assertOptionsObject,
  assertPositiveInteger,
  MAX_CONFIGURED_UPLOAD_BYTES,
  MAX_UPLOAD_BYTES,
} from "./validation.ts";

const MAX_MIME_TYPE_LENGTH = 256;
const MAX_EXTRACTED_TEXT_LENGTH = 16 * 1024 * 1024;
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });
const MAX_CSV_FIELDS = 100_000;

/** Options accepted by {@link loadUpload}. */
export interface UploadLoadOptions {
  /** Maximum accepted input bytes. Defaults to 10 MB. */
  maxBytes?: number;
}

/**
 * Extracts embedding-ready text or Markdown from upload formats.
 *
 * Text and CSV are handled inline. Other formats are delegated to the
 * `DocumentExtractor` extension contract.
 *
 * @example
 * ```ts
 * const markdown = await loadUpload(buffer, "application/pdf");
 * ```
 */
export async function loadUpload(
  buffer: ArrayBuffer,
  mimeType: string,
  options?: UploadLoadOptions,
): Promise<string> {
  if (!(buffer instanceof ArrayBuffer)) {
    throw INVALID_ARGUMENT.create({ detail: "Upload buffer must be an ArrayBuffer" });
  }
  if (options !== undefined) assertOptionsObject(options, "Upload load options");
  const maxBytes = options?.maxBytes ?? MAX_UPLOAD_BYTES;
  assertPositiveInteger(maxBytes, "maxBytes", MAX_CONFIGURED_UPLOAD_BYTES);
  if (buffer.byteLength > maxBytes) {
    const limitMb = Math.ceil(maxBytes / 1024 / 1024);
    throw INVALID_ARGUMENT.create({
      detail: `Upload exceeds the ${limitMb} MB extraction limit`,
    });
  }
  const mediaType = normalizeMimeType(mimeType);

  if (mediaType === "text/csv" || mediaType === "application/csv") {
    return extractCSV(decodeUtf8(buffer));
  }

  if (
    mediaType === "text/plain" ||
    mediaType === "text/markdown" ||
    mediaType === "text/mdx"
  ) {
    return decodeUtf8(buffer);
  }

  const extractor = tryResolve<DocumentExtractor>("DocumentExtractor");
  if (!extractor?.extractInWorker) {
    throw INITIALIZATION_ERROR.create({
      detail: "Document extraction requires a DocumentExtractor extension. " +
        "Install @veryfront/ext-document-kreuzberg and add it to your extensions configuration.",
    });
  }
  const extracted = await extractor.extractInWorker(buffer, mediaType);
  if (typeof extracted !== "string") {
    throw INVALID_ARGUMENT.create({
      detail: "DocumentExtractor returned an invalid extraction result",
    });
  }
  if (extracted.length > MAX_EXTRACTED_TEXT_LENGTH) {
    throw INVALID_ARGUMENT.create({ detail: "Extracted document exceeds the supported size" });
  }
  return extracted;
}

function normalizeMimeType(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > MAX_MIME_TYPE_LENGTH) {
    throw INVALID_ARGUMENT.create({ detail: "Upload MIME type is invalid" });
  }
  const mediaType = value.split(";", 1)[0]!.trim().toLowerCase();
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mediaType)) {
    throw INVALID_ARGUMENT.create({ detail: "Upload MIME type is invalid" });
  }
  return mediaType;
}

function decodeUtf8(buffer: ArrayBuffer): string {
  try {
    return UTF8_DECODER.decode(buffer);
  } catch {
    throw INVALID_ARGUMENT.create({ detail: "Text uploads must contain valid UTF-8" });
  }
}

function extractCSV(text: string): string {
  if (!text) return "";
  const rows = parseCSV(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
    .filter((row) => row.some((value) => value.length > 0));
  if (rows.length < 2) return text;

  const headers = rows[0]!;
  const output: string[] = [];
  let outputLength = 0;
  for (const values of rows.slice(1)) {
    const line = headers
      .map((header, index) => `${header}: ${values[index] ?? ""}`)
      .join(", ");
    outputLength += line.length + (output.length === 0 ? 0 : 1);
    if (outputLength > MAX_EXTRACTED_TEXT_LENGTH) {
      throw INVALID_ARGUMENT.create({ detail: "Extracted CSV exceeds the supported size" });
    }
    output.push(line);
  }
  return output.join("\n");
}

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let fieldWasQuoted = false;
  let quoteClosed = false;
  let fieldCount = 0;

  const finishField = () => {
    fieldCount++;
    if (fieldCount > MAX_CSV_FIELDS) {
      throw INVALID_ARGUMENT.create({ detail: "CSV contains too many fields" });
    }
    row.push(fieldWasQuoted ? field : field.trim());
    field = "";
    fieldWasQuoted = false;
    quoteClosed = false;
  };
  const finishRow = () => {
    finishField();
    rows.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index++) {
    const character = text[index]!;
    if (character === '"') {
      if (inQuotes && text[index + 1] === '"') {
        field += '"';
        index++;
      } else if (inQuotes) {
        inQuotes = false;
        quoteClosed = true;
      } else if (field.length === 0 && !quoteClosed) {
        inQuotes = true;
        fieldWasQuoted = true;
      } else {
        throw INVALID_ARGUMENT.create({ detail: "CSV contains an unexpected quote" });
      }
      continue;
    }

    if (quoteClosed) {
      if (character === ",") {
        finishField();
        continue;
      }
      if (character === "\n" || character === "\r") {
        finishRow();
        if (character === "\r" && text[index + 1] === "\n") index++;
        continue;
      }
      if (character === " " || character === "\t") continue;
      throw INVALID_ARGUMENT.create({
        detail: "CSV contains an unexpected character after a closing quote",
      });
    }

    if (!inQuotes && character === ",") {
      finishField();
      continue;
    }
    if (!inQuotes && (character === "\n" || character === "\r")) {
      finishRow();
      if (character === "\r" && text[index + 1] === "\n") index++;
      continue;
    }
    field += character;
  }

  if (inQuotes) {
    throw INVALID_ARGUMENT.create({ detail: "CSV contains an unterminated quoted field" });
  }
  if (field.length > 0 || row.length > 0 || fieldWasQuoted) finishRow();
  return rows;
}
