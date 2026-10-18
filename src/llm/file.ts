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
  if (/[/\\]/.test(filename) || filename === "." || filename === "..") {
    throw INVALID_ARGUMENT.create({
      message: "File filename must be a base name: no path separators (/ or \\), not . or ..",
    });
  }
  if (typeof mediaType !== "string" || !/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/.test(mediaType)) {
    throw INVALID_ARGUMENT.create({
      message: "File mediaType must be a MIME type without parameters",
    });
  }
  if (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)) {
    throw INVALID_ARGUMENT.create({ message: "File maxBytes must be a positive safe integer" });
  }
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
