import {
  buildDataFileAnnotation,
  type ChatUiMessage,
  type ChatUiMessagePart,
  normalizeInlineAttachmentMediaType,
  type UploadedFileReference,
} from "./types.ts";

/** Check whether the model supports the file media type. */
export function isModelSupportedFileMediaType(mediaType: string): boolean {
  const type = mediaType.toLowerCase();
  return type.startsWith("image/") || type === "application/pdf" || type === "text/plain";
}

function isInlineDataFilePart(part: { readonly url?: string }): boolean {
  return /^data:/i.test(part.url ?? "");
}

type FilePart = Extract<ChatUiMessagePart, { type: "file" }>;

const INLINE_BASE64_PREFIX = /^data:[^,]*;base64,/i;

/**
 * Normalize a file part's MIME type. An inline base64 data URL is rewritten to
 * the same type, so the provider sees matching data; other inline data keeps
 * the MIME type its data URL names.
 */
function normalizeFilePart(part: FilePart): FilePart {
  const inline = isInlineDataFilePart(part);
  if (inline && !INLINE_BASE64_PREFIX.test(part.url)) return part;
  const mediaType = normalizeInlineAttachmentMediaType(part.filename, part.mediaType);
  if (mediaType === part.mediaType) return part;
  return {
    ...part,
    mediaType,
    ...(inline ? { url: part.url.replace(INLINE_BASE64_PREFIX, `data:${mediaType};base64,`) } : {}),
  };
}

/** Normalizes message file part media types. */
export function normalizeMessageFilePartMediaTypes(messages: ChatUiMessage[]): ChatUiMessage[] {
  return messages.map((message) => {
    if (!message.parts.some((part) => part.type === "file")) {
      return message;
    }

    const parts = message.parts.map((part) =>
      part.type === "file" ? normalizeFilePart(part) : part
    );

    return { ...message, parts };
  });
}

function appendDataFileAnnotation(
  kept: ChatUiMessagePart[],
  dataFiles: UploadedFileReference[],
): void {
  const annotation = buildDataFileAnnotation(dataFiles);
  const lastTextIndex = kept.findLastIndex((part) => part.type === "text");

  if (lastTextIndex >= 0) {
    const textPart = kept[lastTextIndex];
    if (textPart?.type === "text") {
      kept[lastTextIndex] = { type: "text", text: textPart.text + annotation };
    }
  } else {
    kept.push({ type: "text", text: annotation.trimStart() });
  }
}

/** Rewrite unsupported file parts as annotations. */
export function rewriteUnsupportedFilePartsAsAnnotations(
  messages: ChatUiMessage[],
): ChatUiMessage[] {
  return messages.map((message) => {
    if (message.parts.length === 0) {
      return message;
    }

    const kept: ChatUiMessagePart[] = [];
    const dataFiles: UploadedFileReference[] = [];

    for (const part of message.parts) {
      if (part.type !== "file") {
        kept.push(part);
        continue;
      }

      const normalized = normalizeFilePart(part);
      // Inline data has no upload a tool could read, so the provider sends or
      // rejects it. Runtimes send files only from user messages.
      if (
        isModelSupportedFileMediaType(normalized.mediaType) ||
        (message.role === "user" && isInlineDataFilePart(part))
      ) {
        kept.push(normalized);
        continue;
      }

      dataFiles.push({
        name: part.filename || "file",
        mediaType: normalized.mediaType,
        // A data URL would put the file's base64 into prompt text.
        ...(part.url && !isInlineDataFilePart(part) ? { url: part.url } : {}),
        ...(part.uploadId ? { uploadId: part.uploadId } : {}),
        ...(part.uploadPath ? { path: part.uploadPath } : {}),
      });
    }

    if (dataFiles.length === 0) {
      return message;
    }

    appendDataFileAnnotation(kept, dataFiles);

    return { ...message, parts: kept };
  });
}
