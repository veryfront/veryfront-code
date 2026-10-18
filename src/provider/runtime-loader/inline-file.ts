import { createError, toError } from "#veryfront/errors";

interface FileInputPart {
  readonly url: string;
  readonly mediaType: string;
  readonly filename?: string;
}

function describeFileInput({ filename, mediaType }: FileInputPart): string {
  return `file input${filename ? ` ${JSON.stringify(filename)}` : ""} (${mediaType})`;
}

function fileInputError(message: string): TypeError {
  return toError(createError({ type: "config", message }), TypeError);
}

/** Whether a prompt part is an image. MIME types compare case-insensitively. */
export function isImageFileInput(
  part: { readonly type: string; readonly mediaType: string },
): boolean {
  return part.type === "image" || part.mediaType.toLowerCase().startsWith("image/");
}

/** Error for a file part that a provider transport cannot send. */
export function unsupportedFileInputError(
  transport: string,
  part: FileInputPart,
  remedy: string,
): TypeError {
  return fileInputError(`${transport} does not support ${describeFileInput(part)}. ${remedy}`);
}

/**
 * Read the base64 payload of an inline `data:` file part.
 * Returns `undefined` for remote URLs. MIME types compare case-insensitively.
 */
export function readInlineFileData(part: FileInputPart): string | undefined {
  if (!part.url.startsWith("data:")) return undefined;
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(part.url);
  if (
    !match?.[2] || match[2].length % 4 !== 0 ||
    match[1]!.toLowerCase() !== part.mediaType.toLowerCase()
  ) {
    throw fileInputError(
      `Inline ${describeFileInput(part)} must be base64 data with a matching MIME type`,
    );
  }
  return match[2];
}
