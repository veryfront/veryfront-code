import type { ChatFileUiPart, ChatUiMessage, FileUIPartWithUpload } from "../chat/types.ts";

export type RuntimeFileUrlResolverInput = {
  uploadId: string;
  part: FileUIPartWithUpload;
  message: ChatUiMessage;
};

export type RuntimeFileUrlResolver = (
  input: RuntimeFileUrlResolverInput,
) => Promise<string | undefined>;

export async function resolveRuntimeMessageFileUrls(
  messages: readonly ChatUiMessage[],
  resolveFileUrl: RuntimeFileUrlResolver,
): Promise<ChatUiMessage[]> {
  const urlByUploadId = new Map<string, Promise<string | undefined>>();

  return Promise.all(
    messages.map(async (message) => {
      if (!message.parts.some((part) => part.type === "file" && part.uploadId)) {
        return message;
      }

      const parts = await Promise.all(
        message.parts.map(async (part) => {
          if (!isFilePartWithUpload(part)) return part;

          let urlPromise = urlByUploadId.get(part.uploadId);
          if (!urlPromise) {
            urlPromise = resolveFileUrl({ uploadId: part.uploadId, part, message });
            urlByUploadId.set(part.uploadId, urlPromise);
          }

          const signedUrl = await urlPromise;
          if (!signedUrl || signedUrl === part.url) return part;

          return {
            ...part,
            url: signedUrl,
          };
        }),
      );

      return { ...message, parts };
    }),
  );
}

function isFilePartWithUpload(part: ChatUiMessage["parts"][number]): part is ChatFileUiPart & {
  uploadId: string;
} {
  return part.type === "file" && typeof part.uploadId === "string" && part.uploadId.length > 0;
}
