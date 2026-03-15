import { VeryfrontError } from "#veryfront/errors/types.ts";
import { readBodyWithLimit } from "#veryfront/security/index.ts";
import {
  DEFAULT_MAX_BODY_SIZE_BYTES,
  HTTP_PAYLOAD_TOO_LARGE,
} from "#veryfront/utils/constants/index.ts";

export const INTERNAL_AGENT_STREAM_MAX_BODY_BYTES = DEFAULT_MAX_BODY_SIZE_BYTES;
export const INTERNAL_AGENT_CONTROL_PLANE_MAX_BODY_BYTES = 128 * 1024;

export class InternalAgentRequestBodyTooLargeError extends Error {
  readonly status = HTTP_PAYLOAD_TOO_LARGE;

  constructor(message = "Payload too large") {
    super(message);
    this.name = "InternalAgentRequestBodyTooLargeError";
  }
}

export async function readInternalAgentRequestBody(
  request: Request,
  maxBodyBytes = INTERNAL_AGENT_STREAM_MAX_BODY_BYTES,
): Promise<string> {
  if (!request.body) {
    return "";
  }

  try {
    return await readBodyWithLimit(request, maxBodyBytes);
  } catch (error) {
    if (
      error instanceof VeryfrontError &&
      error.slug === "input-validation-failed" &&
      error.detail === "Request body exceeds size limit"
    ) {
      throw new InternalAgentRequestBodyTooLargeError();
    }

    throw error;
  }
}
