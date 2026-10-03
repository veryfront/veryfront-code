/** Largest SSE frame a decoder buffers before it gives up on the stream. */
export const MAX_SSE_FRAME_CHARS = 8 * 1024 * 1024;

/** Normalize CRLF and lone CR line ends to LF. */
export function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/** Split LF-normalized SSE text into complete frames and the unterminated remainder. */
export function splitSseFrames(value: string): { frames: string[]; remainder: string } {
  const blocks = value.split("\n\n");
  return {
    frames: blocks.slice(0, -1),
    remainder: blocks.at(-1) ?? "",
  };
}

export function isCommentOnlySseFrame(raw: string): boolean {
  return raw
    .split("\n")
    .every((line) => line.trim().length === 0 || line.trimStart().startsWith(":"));
}
