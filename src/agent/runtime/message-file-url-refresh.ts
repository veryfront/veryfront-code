import {
  type ChatUiMessage,
  type FileUIPartWithUpload,
  isTextPreviewFile,
} from "../../chat/types.ts";

const MAX_INLINE_FILE_CONTENT_CHARS = 200_000;
const MAX_TOTAL_INLINE_FILE_CONTENT_CHARS = 400_000;
const DEFAULT_RUNTIME_FILE_CONTENT_FETCH_TIMEOUT_MS = 15_000;

/** Input payload for runtime file URL resolver. */
export type RuntimeFileUrlResolverInput = {
  uploadId: string;
  part: FileUIPartWithUpload;
  message: ChatUiMessage;
};

/** Public API contract for runtime file URL resolver. */
export type RuntimeFileUrlResolver = (
  input: RuntimeFileUrlResolverInput,
) => Promise<string | undefined>;

/** Input payload for runtime file content fetcher. */
export type RuntimeFileContentFetcherInput = {
  url: string;
  mediaType: string;
  filename?: string;
  uploadId?: string;
  uploadPath?: string;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
  part: FileUIPartWithUpload;
  message: ChatUiMessage;
};

/** Public API contract for runtime file content fetcher. */
export type RuntimeFileContentFetcher = (
  input: RuntimeFileContentFetcherInput,
) => Promise<string | undefined>;

/** Creates a safe runtime file content fetcher. */
export function createRuntimeFileContentFetcher(
  options: {
    trustedUrls?: ReadonlySet<string>;
    abortSignal?: AbortSignal;
    timeoutMs?: number;
  } = {},
): RuntimeFileContentFetcher {
  const trustedUrls = options.trustedUrls;
  return async (input) => {
    if (!isFetchableRuntimeFileContentUrl(input.url, trustedUrls)) {
      return undefined;
    }

    const abortSignal = input.abortSignal ?? options.abortSignal;
    const timeoutMs = input.timeoutMs ?? options.timeoutMs;
    return await fetchRuntimeTextFileContent({
      ...input,
      ...(abortSignal ? { abortSignal } : {}),
      ...(timeoutMs != null ? { timeoutMs } : {}),
    });
  };
}

/** Resolves runtime message file urls. */
export async function resolveRuntimeMessageFileUrls(
  messages: readonly ChatUiMessage[],
  resolveFileUrl: RuntimeFileUrlResolver,
): Promise<ChatUiMessage[]> {
  const urlByUploadId = new Map<string, Promise<string | undefined>>();

  return Promise.all(
    messages.map(async (message) => {
      if (!message.parts.some((part) => getUploadId(part))) {
        return message;
      }

      const parts = await Promise.all(
        message.parts.map(async (part) => {
          const uploadId = getUploadId(part);
          if (!uploadId) return part;

          let urlPromise = urlByUploadId.get(uploadId);
          if (!urlPromise) {
            urlPromise = resolveFileUrl({
              uploadId,
              part: toResolverPart(part, uploadId),
              message,
            });
            urlByUploadId.set(uploadId, urlPromise);
          }

          const signedUrl = await urlPromise;
          if (!signedUrl) return normalizeUploadedFilePart(part, uploadId);

          return {
            ...normalizeUploadedFilePart(part, uploadId),
            url: signedUrl,
          };
        }),
      );

      return { ...message, parts };
    }),
  );
}

/** Fetches text attachment bodies and adds them as adjacent text parts. */
export async function inlineRuntimeMessageFileContents(
  messages: readonly ChatUiMessage[],
  fetchFileContent: RuntimeFileContentFetcher = createRuntimeFileContentFetcher(),
  options: {
    abortSignal?: AbortSignal;
    fetchTimeoutMs?: number;
  } = {},
): Promise<ChatUiMessage[]> {
  const contentByUrl = new Map<string, Promise<InlineFileContent | undefined>>();
  const newestUserMessageIndex = findNewestUserMessageIndex(messages);
  const inlineTextByPart = new Map<string, string>();
  let remainingBudget = MAX_TOTAL_INLINE_FILE_CONTENT_CHARS;

  // Allocate the aggregate inline budget newest-first so the most recent
  // attachments win, then skip fetching entirely once the budget is spent.
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
    const message = messages[messageIndex]!;
    for (let partIndex = 0; partIndex < message.parts.length; partIndex++) {
      const file = getInlineableFilePart(message.parts[partIndex]);
      if (!file) continue;

      if (remainingBudget <= 0) {
        inlineTextByPart.set(
          `${messageIndex}:${partIndex}`,
          "[attachment content omitted: inline budget exceeded]",
        );
        continue;
      }

      let contentPromise = contentByUrl.get(file.url);
      if (!contentPromise) {
        contentPromise = fetchFileContent({
          url: file.url,
          mediaType: file.mediaType,
          ...(file.filename ? { filename: file.filename } : {}),
          ...(file.uploadId ? { uploadId: file.uploadId } : {}),
          ...(file.uploadPath ? { uploadPath: file.uploadPath } : {}),
          ...(options.abortSignal ? { abortSignal: options.abortSignal } : {}),
          ...(options.fetchTimeoutMs != null ? { timeoutMs: options.fetchTimeoutMs } : {}),
          part: file,
          message,
        }).then(normalizeInlineFileContent);
        contentByUrl.set(file.url, contentPromise);
      }

      let inlineContent: InlineFileContent | undefined;
      try {
        inlineContent = await contentPromise;
      } catch (error) {
        // Attachments on the newest user message must stay hard failures, and
        // caller aborts always propagate; stale history attachments degrade.
        if (messageIndex === newestUserMessageIndex || options.abortSignal?.aborted) {
          throw error;
        }
        inlineTextByPart.set(
          `${messageIndex}:${partIndex}`,
          `[attachment unavailable: ${file.filename ?? file.uploadId ?? "file"}]`,
        );
        continue;
      }
      if (!inlineContent) continue;

      let content = inlineContent.content;
      let truncated = inlineContent.truncated;
      if (content.length > remainingBudget) {
        content = content.slice(0, remainingBudget);
        truncated = true;
      }
      remainingBudget -= content.length;

      inlineTextByPart.set(
        `${messageIndex}:${partIndex}`,
        buildInlineFileContentText(
          file,
          truncated ? `${content}\n\n[Attachment content truncated]` : content,
        ),
      );
    }
  }

  return messages.map((message, messageIndex) => {
    if (!message.parts.some((part) => shouldInlineFileContent(part))) {
      return message;
    }

    const parts: ChatUiMessage["parts"] = [];
    for (let partIndex = 0; partIndex < message.parts.length; partIndex++) {
      parts.push(message.parts[partIndex]!);

      const text = inlineTextByPart.get(`${messageIndex}:${partIndex}`);
      if (text) {
        parts.push({ type: "text", text });
      }
    }

    return { ...message, parts };
  });
}

type InlineFileContent = {
  content: string;
  truncated: boolean;
};

function findNewestUserMessageIndex(messages: readonly ChatUiMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.role === "user") {
      return index;
    }
  }
  return -1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getStringField(part: unknown, key: string): string | undefined {
  if (!isRecord(part)) return undefined;

  const value = part[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function getUploadId(part: unknown): string | undefined {
  if (!isRecord(part) || (part.type !== "file" && part.type !== "image")) {
    return undefined;
  }

  return getStringField(part, "uploadId") ?? getStringField(part, "upload_id");
}

function getUploadPath(part: unknown): string | undefined {
  return getStringField(part, "uploadPath") ?? getStringField(part, "upload_path");
}

function getMediaType(part: unknown): string | undefined {
  return getStringField(part, "mediaType") ?? getStringField(part, "media_type");
}

function normalizeUploadedFilePart(
  part: ChatUiMessage["parts"][number],
  uploadId: string,
): ChatUiMessage["parts"][number] {
  if (!isRecord(part)) return part;

  const partRecord: Record<string, unknown> = part;
  const partType = partRecord.type;
  if (partType !== "file" && partType !== "image") return part;

  const mediaType = getMediaType(part);
  const url = getStringField(part, "url");
  if (!mediaType || !url) return part;

  const filename = getStringField(part, "filename");
  const uploadPath = getStringField(part, "uploadPath") ?? getStringField(part, "upload_path");

  return {
    type: partType === "image" ? "image" : "file",
    mediaType,
    url,
    ...(filename ? { filename } : {}),
    uploadId,
    ...(uploadPath ? { uploadPath } : {}),
  } as ChatUiMessage["parts"][number];
}

function shouldInlineFileContent(part: unknown): boolean {
  return getInlineableFilePart(part) !== null;
}

function getInlineableFilePart(part: unknown): FileUIPartWithUpload | null {
  if (!isRecord(part) || part.type !== "file") return null;

  const mediaType = getMediaType(part);
  const url = getStringField(part, "url");
  if (!mediaType || !url) return null;

  const filename = getStringField(part, "filename");
  if (!isTextPreviewFile(filename, mediaType)) return null;

  return {
    type: "file",
    mediaType,
    url,
    ...(filename ? { filename } : {}),
    ...(getUploadId(part) ? { uploadId: getUploadId(part) } : {}),
    ...(getUploadPath(part) ? { uploadPath: getUploadPath(part) } : {}),
  };
}

async function fetchRuntimeTextFileContent(
  input: RuntimeFileContentFetcherInput,
): Promise<string | undefined> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_RUNTIME_FILE_CONTENT_FETCH_TIMEOUT_MS;
  const fetchSignal = createRuntimeFileContentFetchSignal(input.abortSignal, timeoutMs);
  const response = await waitForRuntimeFileContentFetchOperation(
    fetch(input.url, { signal: fetchSignal.signal }),
    input,
    fetchSignal,
    timeoutMs,
  );
  if (!response.ok) {
    throw new Error(
      `Failed to fetch text attachment content${
        formatFileContentFetchLabel(input)
      }: HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`,
    );
  }
  return await readRuntimeTextFileContent(response, input, fetchSignal, timeoutMs);
}

async function readRuntimeTextFileContent(
  response: Response,
  input: RuntimeFileContentFetcherInput,
  fetchSignal: ReturnType<typeof createRuntimeFileContentFetchSignal>,
  timeoutMs: number,
): Promise<string | undefined> {
  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let content = "";
  let shouldCancelReader = false;

  try {
    while (content.length <= MAX_INLINE_FILE_CONTENT_CHARS) {
      const result = await waitForRuntimeFileContentFetchOperation(
        reader.read(),
        input,
        fetchSignal,
        timeoutMs,
      );
      if (result.done) {
        return appendRuntimeTextContentUntilInlineLimit(content, decoder.decode()).content;
      }

      const nextContent = appendRuntimeTextContentUntilInlineLimit(
        content,
        decoder.decode(result.value, { stream: true }),
      );
      content = nextContent.content;
      if (nextContent.reachedLimit) {
        shouldCancelReader = true;
        return content;
      }
    }

    return content;
  } finally {
    if (shouldCancelReader || fetchSignal.signal.aborted) {
      void reader.cancel().catch(() => {});
    }
    try {
      reader.releaseLock();
    } catch {
      // Ignore release failures after cancellation has already been requested.
    }
  }
}

function appendRuntimeTextContentUntilInlineLimit(
  content: string,
  decoded: string,
): { content: string; reachedLimit: boolean } {
  const readLimit = MAX_INLINE_FILE_CONTENT_CHARS + 1;
  const remainingChars = readLimit - content.length;
  if (decoded.length >= remainingChars) {
    return {
      content: `${content}${decoded.slice(0, Math.max(0, remainingChars))}`,
      reachedLimit: true,
    };
  }

  return { content: `${content}${decoded}`, reachedLimit: false };
}

/** Composes abort signals manually for runtimes without AbortSignal.any (Node < 20.3). */
export function composeAbortSignals(signals: readonly AbortSignal[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

function anyAbortSignal(signals: readonly AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any([...signals]);
  }
  return composeAbortSignals(signals);
}

function createRuntimeFileContentFetchSignal(
  abortSignal: AbortSignal | undefined,
  timeoutMs: number,
): {
  signal: AbortSignal;
  wasAbortedByCaller: () => boolean;
  didTimeout: () => boolean;
} {
  const timeoutSignal = AbortSignal.timeout(Math.max(0, timeoutMs));
  if (!abortSignal) {
    return {
      signal: timeoutSignal,
      wasAbortedByCaller: () => false,
      didTimeout: () => timeoutSignal.aborted,
    };
  }

  return {
    signal: anyAbortSignal([abortSignal, timeoutSignal]),
    wasAbortedByCaller: () => abortSignal.aborted,
    didTimeout: () => timeoutSignal.aborted,
  };
}

async function waitForRuntimeFileContentFetchOperation<T>(
  operation: Promise<T>,
  input: RuntimeFileContentFetcherInput,
  fetchSignal: ReturnType<typeof createRuntimeFileContentFetchSignal>,
  timeoutMs: number,
): Promise<T> {
  let abortError: Error | undefined;
  let removeAbortListener = () => {};
  const abortPromise = new Promise<never>((_, reject) => {
    const rejectAbort = () => {
      abortError = createRuntimeFileContentAbortError(
        input,
        fetchSignal,
        timeoutMs,
      );
      reject(abortError);
    };
    if (fetchSignal.signal.aborted) {
      rejectAbort();
      return;
    }

    fetchSignal.signal.addEventListener("abort", rejectAbort, { once: true });
    removeAbortListener = () => fetchSignal.signal.removeEventListener("abort", rejectAbort);
  });

  try {
    return await Promise.race([operation, abortPromise]);
  } catch (error) {
    if (error === abortError) {
      throw error;
    }
    const abortFailure = createRuntimeFileContentAbortError(
      input,
      fetchSignal,
      timeoutMs,
      error,
    );
    if (abortFailure) {
      throw abortFailure;
    }
    throw error;
  } finally {
    removeAbortListener();
  }
}

function createRuntimeFileContentAbortError(
  input: RuntimeFileContentFetcherInput,
  fetchSignal: ReturnType<typeof createRuntimeFileContentFetchSignal>,
  timeoutMs: number,
  cause?: unknown,
): Error | undefined {
  if (fetchSignal.wasAbortedByCaller()) {
    return new Error(
      `Failed to fetch text attachment content${
        formatFileContentFetchLabel(input)
      }: request aborted`,
      { cause },
    );
  }
  if (fetchSignal.didTimeout()) {
    return new Error(
      `Failed to fetch text attachment content${
        formatFileContentFetchLabel(input)
      }: request timed out after ${timeoutMs}ms`,
      { cause },
    );
  }
  return undefined;
}

function formatFileContentFetchLabel(input: RuntimeFileContentFetcherInput): string {
  const label = input.filename ?? input.uploadId ?? input.uploadPath;
  return label ? ` for ${label}` : "";
}

function isFetchableRuntimeFileContentUrl(
  url: string,
  trustedUrls: ReadonlySet<string> | undefined,
): boolean {
  if (url.startsWith("data:")) {
    return true;
  }

  return trustedUrls?.has(url) ?? false;
}

function normalizeInlineFileContent(content: string | undefined): InlineFileContent | undefined {
  if (!content || content.trim().length === 0) return undefined;

  if (content.length <= MAX_INLINE_FILE_CONTENT_CHARS) {
    return { content, truncated: false };
  }

  return { content: content.slice(0, MAX_INLINE_FILE_CONTENT_CHARS), truncated: true };
}

function escapeXmlAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(
    />/g,
    "&gt;",
  );
}

function buildInlineFileContentText(
  part: FileUIPartWithUpload,
  content: string,
): string {
  const name = part.filename ?? part.uploadId ?? "file";
  return `Attached file content:\n\n<file_content name="${escapeXmlAttr(name)}" type="${
    escapeXmlAttr(part.mediaType)
  }">\n${content}\n</file_content>`;
}

function toResolverPart(
  part: ChatUiMessage["parts"][number],
  uploadId: string,
): FileUIPartWithUpload {
  const normalized = normalizeUploadedFilePart(part, uploadId);
  if (isRecord(normalized) && normalized.type === "file") {
    return normalized as FileUIPartWithUpload;
  }

  return {
    type: "file",
    mediaType: getMediaType(part) ?? "application/octet-stream",
    url: getStringField(part, "url") ?? "",
    uploadId,
  };
}
