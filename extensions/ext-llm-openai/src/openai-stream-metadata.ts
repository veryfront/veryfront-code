export const MAX_OPENAI_STREAM_IDENTIFIER_BYTES = 512;
export const MAX_OPENAI_STREAM_TOOL_NAME_BYTES = 256;
export const MAX_OPENAI_STREAM_ITEM_TYPE_BYTES = 128;
export const MAX_OPENAI_STREAM_CONTENT_PARTS = 4_096;

const encoder = new TextEncoder();

export function isBoundedOpenAIStreamString(
  value: unknown,
  maxBytes: number,
): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    encoder.encode(value).byteLength <= maxBytes;
}
