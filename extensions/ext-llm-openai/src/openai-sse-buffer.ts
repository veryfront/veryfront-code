import {
  MAX_PROVIDER_SSE_BUFFER_CODE_UNITS,
  parseFinalSseChunk,
  parseSseChunk,
} from "veryfront/provider/shared";

type InvalidStreamFactory = (issue: string) => Error;

export { MAX_PROVIDER_SSE_BUFFER_CODE_UNITS as MAX_OPENAI_SSE_BUFFER_CODE_UNITS };
export const MAX_OPENAI_SSE_RAW_CHUNK_BYTES = MAX_PROVIDER_SSE_BUFFER_CODE_UNITS * 3 + 3;

export function appendOpenAISseChunk(
  decoder: TextDecoder,
  buffer: string,
  chunk: Uint8Array,
  invalid: InvalidStreamFactory,
): string {
  if (!(chunk instanceof Uint8Array)) {
    throw invalid("stream chunk was not binary data");
  }
  const remainingCodeUnits = MAX_PROVIDER_SSE_BUFFER_CODE_UNITS - buffer.length;
  // Valid UTF-8 needs at most three bytes per UTF-16 code unit. The extra
  // three bytes cover an incomplete sequence retained by the decoder.
  if (
    chunk.byteLength > MAX_OPENAI_SSE_RAW_CHUNK_BYTES ||
    chunk.byteLength > remainingCodeUnits * 3 + 3
  ) {
    throw invalid(
      `SSE buffer exceeded ${MAX_PROVIDER_SSE_BUFFER_CODE_UNITS} code units`,
    );
  }
  let decoded: string;
  try {
    decoded = decoder.decode(chunk, { stream: true });
  } catch {
    throw invalid("stream contained invalid UTF-8");
  }
  if (decoded.length > MAX_PROVIDER_SSE_BUFFER_CODE_UNITS - buffer.length) {
    throw invalid(
      `SSE buffer exceeded ${MAX_PROVIDER_SSE_BUFFER_CODE_UNITS} code units`,
    );
  }
  return buffer + decoded;
}

export function finishOpenAISseDecoding(
  decoder: TextDecoder,
  buffer: string,
  invalid: InvalidStreamFactory,
): string {
  let decoded: string;
  try {
    decoded = decoder.decode();
  } catch {
    throw invalid("stream contained invalid UTF-8");
  }
  if (decoded.length > MAX_PROVIDER_SSE_BUFFER_CODE_UNITS - buffer.length) {
    throw invalid(
      `SSE buffer exceeded ${MAX_PROVIDER_SSE_BUFFER_CODE_UNITS} code units`,
    );
  }
  return buffer + decoded;
}

export function parseOpenAISseBuffer(
  buffer: string,
  invalid: InvalidStreamFactory,
  trailing = false,
): ReturnType<typeof parseSseChunk> {
  try {
    return trailing ? parseFinalSseChunk(buffer) : parseSseChunk(buffer);
  } catch {
    throw invalid(
      trailing ? "trailing SSE event was malformed" : "SSE event framing was malformed",
    );
  }
}
