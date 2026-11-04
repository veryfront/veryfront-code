import { createError, toError } from "#veryfront/errors";

interface FileInputPart {
  readonly url: string;
  readonly mediaType: string;
  readonly filename?: string;
}

/**
 * The base name of a file part's filename, or `undefined` when none is usable.
 * Requests and errors leave the machine, so a local path must not.
 */
export function fileInputBaseName(filename: string | undefined): string | undefined {
  // A Windows drive-relative name such as `C:report.pdf` is a path too.
  const name = filename?.split(/[/\\]/).pop()?.replace(/^[A-Za-z]:/, "");
  return name && name !== "." && name !== ".." ? name : undefined;
}

// A MIME type without parameters. Anything else is not echoed into errors.
const MEDIA_TYPE = /^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/;

function describeFileInput({ filename, mediaType }: FileInputPart): string {
  const name = fileInputBaseName(filename);
  const type = MEDIA_TYPE.test(mediaType) ? mediaType : "invalid media type";
  return `file input${name ? ` ${JSON.stringify(name)}` : ""} (${type})`;
}

// `image/jpg` is a common non-standard alias for `image/jpeg`.
function canonicalMediaType(mediaType: string): string {
  const type = mediaType.toLowerCase();
  return type === "image/jpg" ? "image/jpeg" : type;
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

/** Whether a base URL is OpenAI's own API. No base URL means the default, which is. */
export function isOpenAIBaseURL(baseURL: string | undefined): boolean {
  if (!baseURL) return true;
  if (!URL.canParse(baseURL)) return false;
  const hostname = new URL(baseURL).hostname.toLowerCase();
  return hostname === "api.openai.com" || hostname.endsWith(".api.openai.com");
}

/**
 * Whether an OpenAI-wire provider serves document input on Responses, so the
 * `auto` transport may move a request with a document there. Mistral and
 * generic compatible servers do not, and keep the local Chat Completions error.
 * An `openai` provider on a custom base URL is a compatible server too.
 */
export function routesOpenAIDocumentInputToResponses(
  providerName: string | undefined,
  baseURL?: string,
): boolean {
  if (providerName === "veryfront-cloud") return true;
  return providerName === "openai" && isOpenAIBaseURL(baseURL);
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
  // RFC 2397 allows parameters, such as `;name=a.png`, before `;base64`.
  const match = /^data:([^;,]+)(?:;[^;,=]+=[^;,]*)*;base64,([A-Za-z0-9+/]*={0,2})$/i.exec(part.url);
  if (
    !match?.[2] || match[2].length % 4 !== 0 ||
    canonicalMediaType(match[1]!) !== canonicalMediaType(part.mediaType)
  ) {
    throw fileInputError(
      `Inline ${describeFileInput(part)} must be base64 data with a matching MIME type`,
    );
  }
  return match[2];
}

/**
 * Return a remote file URL, or throw before inference. A local path or other
 * non-HTTP scheme must not reach the provider request.
 */
export function readRemoteFileUrl(transport: string, part: FileInputPart): string {
  const protocol = URL.canParse(part.url) ? new URL(part.url).protocol : undefined;
  if (protocol !== "https:" && protocol !== "http:") {
    throw unsupportedFileInputError(
      transport,
      part,
      "Send an https URL or inline data, for example with fileFromBytes.",
    );
  }
  return part.url;
}
