import type { ChatFilePart } from "#veryfront/agent/react";
import type { AttachmentInfo } from "./components/attachment-pill.tsx";

/** Map resolved attachments to file message parts. */
export function attachmentsToFileParts(items: AttachmentInfo[]): ChatFilePart[] {
  return items
    .filter((item): item is AttachmentInfo & { url: string } => Boolean(item.url))
    .map((item) => ({
      type: "file",
      mediaType: item.type ?? "application/octet-stream",
      url: item.url,
      filename: item.name,
      ...(item.size != null ? { size: item.size } : {}),
    }));
}

/** Return true while an attachment is still resolving its URL. */
export function hasPendingAttachments(items: AttachmentInfo[]): boolean {
  return items.some((item) => item.state === "uploading" || item.state === "processing");
}
