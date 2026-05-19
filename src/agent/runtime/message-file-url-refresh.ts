import type { ChatUiMessage, FileUIPartWithUpload } from "../../chat/types.ts";

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
