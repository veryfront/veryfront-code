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

// A MIME type without parameters.
const MEDIA_TYPE = /^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/;

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
  if (typeof mediaType !== "string" || !MEDIA_TYPE.test(mediaType)) {
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
  /**
   * The bytes are missing or empty, or a PDF (by `application/pdf` MIME type
   * or `.pdf` filename) has no `%PDF-` header.
   */
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
  /** The input file's base name, without any path, or "" when none is safe to report. */
  filename: string;
  /** The lowercased input MIME type, or "" when it is not a valid MIME type. */
  mediaType: string;
  /** Raw byte length before encoding, or 0 when there are no bytes. */
  bytes: number;
  reason: FilePartOmissionReason;
}

/** Local files and optional raw-byte and count budgets for one message. */
export interface PlanFilePartsInput {
  /** Files to plan. A per-file `maxBytes` is not read; use `maxFileBytes`. */
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

type PlanFile = PlanFilePartsInput["files"][number];

function isPdf({ filename, mediaType }: PlanFile): boolean {
  return mediaType.toLowerCase() === "application/pdf" || /\.pdf$/i.test(filename);
}

function omissionReason(file: PlanFile | null | undefined): FilePartOmissionReason | undefined {
  try {
    assertFileMetadata(file?.filename, file?.mediaType);
  } catch {
    return "invalid_metadata";
  }
  const { bytes } = file!;
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) return "invalid_content";
  if (isPdf(file!) && !hasPdfHeader(bytes)) return "invalid_content";
  return undefined;
}

/** The base name of a filename, or "" when none is safe to report. */
function reportedFilename(filename: unknown): string {
  if (typeof filename !== "string" || /[\r\n\0]/.test(filename)) return "";
  // A local path must not leak into logs, so keep only the base name.
  const name = filename.split(/[/\\]/).pop()!.replace(/^[A-Za-z]:/, "").trim();
  return name === "." || name === ".." ? "" : name;
}

function omittedFile(
  file: PlanFile | null | undefined,
  index: number,
  reason: FilePartOmissionReason,
): OmittedFilePart {
  const bytes: unknown = file?.bytes;
  const filename = file?.filename;
  const mediaType = file?.mediaType;
  return {
    index,
    filename: reportedFilename(filename),
    mediaType: typeof mediaType === "string" && MEDIA_TYPE.test(mediaType)
      ? mediaType.toLowerCase()
      : "",
    bytes: ArrayBuffer.isView(bytes) || bytes instanceof ArrayBuffer ? bytes.byteLength : 0,
    reason,
  };
}

/**
 * Select which local files fit a message, without throwing for file data.
 *
 * Files are checked in input order. Each file is sent when its metadata and
 * content are valid, it fits `maxFileBytes`, fewer than `maxFiles` files were
 * sent, and it fits the remaining `maxTotalBytes`. Omitted files do not use the
 * budget, so a later smaller file can still be sent. Unset budgets do not
 * limit. The plan counts raw bytes only; it does not infer page counts or
 * model context limits. Throws `INVALID_ARGUMENT` only when `files` is not an
 * array or a budget is invalid.
 */
export function planFileParts(
  { files, maxFileBytes, maxTotalBytes, maxFiles }: PlanFilePartsInput,
): FilePartsPlan {
  if (!Array.isArray(files)) {
    throw INVALID_ARGUMENT.create({ message: "files must be an array" });
  }
  assertBudget("maxFileBytes", maxFileBytes);
  assertBudget("maxTotalBytes", maxTotalBytes);
  assertBudget("maxFiles", maxFiles);
  const parts: FilePartsPlan["parts"] = [];
  const omitted: OmittedFilePart[] = [];
  let totalBytes = 0;
  // An index loop, not forEach, so holes in a sparse array are reported too.
  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    let reason = omissionReason(file);
    const size = reason ? 0 : file!.bytes.byteLength;
    if (!reason && maxFileBytes !== undefined && size > maxFileBytes) reason = "over_file_limit";
    if (!reason && maxFiles !== undefined && parts.length >= maxFiles) reason = "over_count_limit";
    if (!reason && maxTotalBytes !== undefined && totalBytes + size > maxTotalBytes) {
      reason = "over_total_budget";
    }
    if (reason) {
      omitted.push(omittedFile(file, index, reason));
      continue;
    }
    totalBytes += size;
    parts.push(
      fileFromBytes({ bytes: file!.bytes, filename: file!.filename, mediaType: file!.mediaType }),
    );
  }
  return { parts, omitted, complete: omitted.length === 0 };
}
