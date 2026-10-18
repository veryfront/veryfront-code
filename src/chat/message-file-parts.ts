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

/** Normalizes message file part media types. */
export function normalizeMessageFilePartMediaTypes(messages: ChatUiMessage[]): ChatUiMessage[] {
  return messages.map((message) => {
    if (!message.parts.some((part) => part.type === "file")) {
      return message;
    }

    const parts = message.parts.map((part) => {
      // Inline data must keep the MIME type its data URL names.
      if (part.type !== "file" || isInlineDataFilePart(part)) {
        return part;
      }

      const mediaType = normalizeInlineAttachmentMediaType(part.filename, part.mediaType);
      if (mediaType === part.mediaType) {
        return part;
      }

      return {
        ...part,
        mediaType,
      };
    });

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

      // Inline data has no upload a tool could read, so the provider sends or rejects it.
      if (isInlineDataFilePart(part)) {
        kept.push(part);
        continue;
      }
      const normalizedMediaType = normalizeInlineAttachmentMediaType(part.filename, part.mediaType);
      if (isModelSupportedFileMediaType(normalizedMediaType)) {
        kept.push({
          ...part,
          mediaType: normalizedMediaType,
        });
        continue;
      }

      dataFiles.push({
        name: part.filename || "file",
        mediaType: normalizedMediaType,
        ...(part.url ? { url: part.url } : {}),
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
