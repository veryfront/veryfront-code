import {
  isRequestBodyTooLargeError,
  readBodyBytesWithLimit,
} from "#veryfront/security/input-validation/limits.ts";
import {
  DEFAULT_MAX_BODY_SIZE_BYTES,
  HTTP_BAD_REQUEST,
  HTTP_PAYLOAD_TOO_LARGE,
} from "#veryfront/utils/constants/index.ts";

const fatalUtf8Decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/** Maximum accepted byte length for an internal agent stream request body. */
export const INTERNAL_AGENT_STREAM_MAX_BODY_BYTES: number = DEFAULT_MAX_BODY_SIZE_BYTES;
/** Maximum accepted byte length for a non-streaming control-plane request body. */
export const INTERNAL_AGENT_CONTROL_PLANE_MAX_BODY_BYTES: number = 128 * 1024;

/** Raised when an internal agent request body exceeds its configured byte limit. */
export class InternalAgentRequestBodyTooLargeError extends Error {
  /** HTTP status returned for this error. */
  readonly status: number = HTTP_PAYLOAD_TOO_LARGE;

  /** Creates an oversized request body error. */
  constructor(message = "Payload too large") {
    super(message);
    this.name = "InternalAgentRequestBodyTooLargeError";
  }
}

/** Raised when an internal agent request body is not valid UTF-8. */
export class InternalAgentRequestBodyEncodingError extends Error {
  /** HTTP status returned for this error. */
  readonly status: number = HTTP_BAD_REQUEST;

  /** Creates an invalid request body encoding error. */
  constructor(message = "Request body must use valid UTF-8") {
    super(message);
    this.name = "InternalAgentRequestBodyEncodingError";
  }
}

/** Reads and decodes an internal agent request body within a byte limit. */
export async function readInternalAgentRequestBody(
  request: Request,
  maxBodyBytes = INTERNAL_AGENT_STREAM_MAX_BODY_BYTES,
): Promise<string> {
  if (!request.body) {
    return "";
  }

  let bytes: Uint8Array;
  try {
    bytes = await readBodyBytesWithLimit(request, maxBodyBytes);
  } catch (error) {
    if (isRequestBodyTooLargeError(error)) {
      throw new InternalAgentRequestBodyTooLargeError();
    }

    throw error;
  }

  try {
    return fatalUtf8Decoder.decode(bytes);
  } catch {
    throw new InternalAgentRequestBodyEncodingError();
  }
}
