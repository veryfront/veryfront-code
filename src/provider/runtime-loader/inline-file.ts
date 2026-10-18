import { createError, toError } from "#veryfront/errors";

interface FileInputPart {
  readonly url: string;
  readonly mediaType: string;
  readonly filename?: string;
}

function describeFileInput({ filename, mediaType }: FileInputPart): string {
  // Errors reach users, so a filename that is a local path shows only its base name.
  const name = filename?.split(/[/\\]/).pop();
  return `file input${name ? ` ${JSON.stringify(name)}` : ""} (${mediaType})`;
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

/** Whether a prompt carries a non-image file in a user message. */
export function promptHasDocumentInput(prompt: unknown): boolean {
  if (!Array.isArray(prompt)) return false;
  return prompt.some((message) =>
    message?.role === "user" && Array.isArray(message.content) &&
    message.content.some((part: { type?: unknown; mediaType?: unknown } | null) =>
      (part?.type === "file" || part?.type === "image") &&
      typeof part.mediaType === "string" &&
      !isImageFileInput(part as { type: string; mediaType: string })
    )
  );
}

/**
 * Whether an OpenAI-wire provider serves document input on Responses, so the
 * `auto` transport may move a request with a document there. Mistral and
 * generic compatible servers do not, and keep the local Chat Completions error.
 */
export function routesOpenAIDocumentInputToResponses(providerName: string | undefined): boolean {
  return providerName === "openai" || providerName === "veryfront-cloud";
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
  // URL schemes are case-insensitive, so `DATA:` is inline data too.
  if (!/^data:/i.test(part.url)) return undefined;
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/i.exec(part.url);
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
