import type { MessagePart } from "#veryfront/agent/types.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";
import { encodeBase64Bytes } from "#veryfront/utils/base64url.ts";

/** Local file input. Read bytes with your runtime's filesystem or File API. */
export interface FileBytesInput {
  bytes: Uint8Array;
  filename: string;
  /** MIME type, such as application/pdf. */
  mediaType: string;
  /** Optional raw-byte budget, checked before base64 encoding. */
  maxBytes?: number;
}

function assertFileMetadata(filename: unknown, mediaType: unknown): void {
  if (typeof filename !== "string" || !filename.trim() || /[\r\n\0]/.test(filename)) {
    throw INVALID_ARGUMENT.create({
      message: "File filename must be non-empty and contain no control characters (CR, LF, NUL)",
    });
  }
  if (filename !== filename.trim()) {
    throw INVALID_ARGUMENT.create({
      message: "File filename must not start or end with whitespace",
    });
  }
  // Providers receive the filename and errors echo it, so a local path must not leak.
  if (/[/\\]|^[A-Za-z]:/.test(filename) || filename === "." || filename === "..") {
    throw INVALID_ARGUMENT.create({
      message: "File filename must be a base name, not a path (/, \\ or a drive prefix), . or ..",
    });
  }
  if (typeof mediaType !== "string" || !/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/.test(mediaType)) {
    throw INVALID_ARGUMENT.create({
      message: "File mediaType must be a MIME type without parameters",
    });
  }
}

function assertBudget(name: string, value: number | undefined): void {
  if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
    throw INVALID_ARGUMENT.create({ message: `${name} must be a positive safe integer` });
  }
}

/**
 * Build a serializable message file part without uploading the file.
 *
 * Use the returned part in agent or generate user messages. Provider and model
 * file support still applies. Base64 increases request size by about one third.
 */
export function fileFromBytes(
  { bytes, filename, mediaType, maxBytes }: FileBytesInput,
): Extract<MessagePart, { type: "file" }> {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
    throw INVALID_ARGUMENT.create({ message: "File bytes must be a non-empty Uint8Array" });
  }
  assertFileMetadata(filename, mediaType);
  assertBudget("File maxBytes", maxBytes);
  if (maxBytes !== undefined && bytes.byteLength > maxBytes) {
    throw INVALID_ARGUMENT.create({ message: "File exceeds maxBytes" });
  }
  const normalizedMediaType = mediaType.toLowerCase();
  return {
    type: "file",
    url: `data:${normalizedMediaType};base64,${encodeBase64Bytes(bytes)}`,
    filename,
    mediaType: normalizedMediaType,
  };
}

/** Why `planFileParts` did not send a file. */
export type FilePartOmissionReason =
  /** The filename or MIME type is invalid. */
  | "invalid_metadata"
  /** The bytes are empty, or an application/pdf file has no `%PDF-` header. */
  | "invalid_content"
  /** The file is larger than `maxFileBytes`. */
  | "over_file_limit"
  /** `maxFiles` files were already sent. */
  | "over_count_limit"
  /** Sending the file would exceed `maxTotalBytes`. */
  | "over_total_budget";

/** A file that `planFileParts` did not send. File bytes are not included. */
export interface OmittedFilePart {
  /** Position of the file in the input list. */
  index: number;
  filename: string;
  mediaType: string;
  /** Raw byte length before encoding. */
  bytes: number;
  reason: FilePartOmissionReason;
}

/** Local files and optional raw-byte and count budgets for one message. */
export interface PlanFilePartsInput {
  files: ReadonlyArray<Omit<FileBytesInput, "maxBytes">>;
  /** Largest raw size for one file. */
  maxFileBytes?: number;
  /** Largest raw size for all sent files together. */
  maxTotalBytes?: number;
  /** Largest number of sent files. */
  maxFiles?: number;
}

/** File parts to send and every file that was left out. */
export interface FilePartsPlan {
  parts: Array<Extract<MessagePart, { type: "file" }>>;
  omitted: OmittedFilePart[];
  /** True only when every input file is in `parts`. */
  complete: boolean;
}

/** Leading bytes searched for the PDF header, as PDF readers allow leading junk. */
const PDF_HEADER_SEARCH_BYTES = 1024;
const PDF_HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

function hasPdfHeader(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.byteLength, PDF_HEADER_SEARCH_BYTES) - PDF_HEADER.length;
  for (let start = 0; start <= end; start++) {
    if (PDF_HEADER.every((byte, offset) => bytes[start + offset] === byte)) return true;
  }
  return false;
}

function omissionReason(
  { bytes, filename, mediaType }: PlanFilePartsInput["files"][number],
): FilePartOmissionReason | undefined {
  try {
    assertFileMetadata(filename, mediaType);
  } catch {
    return "invalid_metadata";
  }
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) return "invalid_content";
  if (mediaType.toLowerCase() === "application/pdf" && !hasPdfHeader(bytes)) {
    return "invalid_content";
  }
  return undefined;
}

/**
 * Select which local files fit a message, without throwing for file data.
 *
 * Files are checked in input order. Each file is sent when its metadata and
 * content are valid, it fits `maxFileBytes`, fewer than `maxFiles` files were
 * sent, and it fits the remaining `maxTotalBytes`. Omitted files do not use the
 * budget, so a later smaller file can still be sent. Unset budgets do not
 * limit. The plan counts raw bytes only; it does not infer page counts or
 * model context limits. Throws `INVALID_ARGUMENT` only for invalid budgets.
 */
export function planFileParts(
  { files, maxFileBytes, maxTotalBytes, maxFiles }: PlanFilePartsInput,
): FilePartsPlan {
  assertBudget("maxFileBytes", maxFileBytes);
  assertBudget("maxTotalBytes", maxTotalBytes);
  assertBudget("maxFiles", maxFiles);
  const parts: FilePartsPlan["parts"] = [];
  const omitted: OmittedFilePart[] = [];
  let totalBytes = 0;
  files.forEach((file, index) => {
    const size = file.bytes instanceof Uint8Array ? file.bytes.byteLength : 0;
    let reason = omissionReason(file);
    if (!reason && maxFileBytes !== undefined && size > maxFileBytes) reason = "over_file_limit";
    if (!reason && maxFiles !== undefined && parts.length >= maxFiles) reason = "over_count_limit";
    if (!reason && maxTotalBytes !== undefined && totalBytes + size > maxTotalBytes) {
      reason = "over_total_budget";
    }
    if (reason) {
      omitted.push({
        index,
        filename: String(file.filename),
        mediaType: String(file.mediaType),
        bytes: size,
        reason,
      });
      return;
    }
    totalBytes += size;
    parts.push(
      fileFromBytes({ bytes: file.bytes, filename: file.filename, mediaType: file.mediaType }),
    );
  });
  return { parts, omitted, complete: omitted.length === 0 };
}
