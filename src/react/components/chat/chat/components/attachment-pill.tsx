import * as React from "react";
import { cn } from "../../theme.ts";

/** Public API contract for attachment info. */
export interface AttachmentInfo {
  id: string;
  name: string;
  status?: "uploading" | "ready";
  type?: string;
  size?: number;
  preview?: string;
}

/** Props accepted by attachment pill. */
export interface AttachmentPillProps {
  attachment: AttachmentInfo;
  onRemove?: (id: string) => void;
}

const FILE_TYPE_COLORS: Record<string, string> = {
  pdf: "text-red-700 bg-red-100",
  docx: "text-blue-700 bg-blue-100",
  csv: "text-emerald-700 bg-emerald-100",
  txt: "text-[var(--faint)] bg-[var(--tertiary)]",
  md: "text-purple-700 bg-purple-100",
  mdx: "text-purple-700 bg-purple-100",
};

function getExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getTypeLabel(
  attachment: AttachmentInfo,
  ext: string,
  mediaType: string,
): string {
  if (attachment.status === "uploading") return "Uploading";
  if (attachment.size != null) return formatSize(attachment.size);
  return mediaType || ext.toUpperCase() || "File";
}

/** Render attachment pill. */
export function AttachmentPill({
  attachment,
  onRemove,
}: AttachmentPillProps): React.ReactElement {
  const [showPreview, setShowPreview] = React.useState(false);
  const mediaType = attachment.type ?? "";
  const ext = getExtension(attachment.name) ||
    mediaType.split("/").pop()?.toLowerCase() || "";
  const colorClass = FILE_TYPE_COLORS[ext] ??
    "text-[var(--faint)] bg-[var(--tertiary)]";
  const isImage = mediaType.startsWith("image/") ||
    /\.(avif|gif|jpe?g|png|webp)$/i.test(attachment.name);
  const typeLabel = getTypeLabel(attachment, ext, mediaType);

  return (
    <div
      className={cn(
        "group relative flex w-[200px] items-center gap-3 rounded-[var(--radius-md)] border border-[var(--edge-medium)] bg-[var(--secondary)] py-1 pl-1 pr-2 text-[var(--foreground)]",
        attachment.status === "uploading" && "opacity-70",
      )}
      onMouseEnter={() => setShowPreview(true)}
      onMouseLeave={() => setShowPreview(false)}
    >
      {isImage && attachment.preview
        ? (
          <div className="relative size-10 shrink-0 overflow-hidden rounded-[var(--radius-sm)] bg-[var(--tertiary)]">
            <img
              alt=""
              className="size-full object-cover"
              src={attachment.preview}
            />
            {attachment.status === "uploading" && (
              <div className="absolute inset-0 flex items-center justify-center rounded-[var(--radius-sm)] bg-[var(--overlay)]">
                <span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              </div>
            )}
          </div>
        )
        : (
          <div
            className={cn(
              "relative flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[10px] font-medium uppercase leading-none",
              colorClass,
            )}
          >
            {ext || "file"}
            {attachment.status === "uploading" && (
              <div className="absolute inset-0 flex items-center justify-center rounded-[var(--radius-sm)] bg-[var(--overlay)]">
                <span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              </div>
            )}
          </div>
        )}

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="truncate text-sm font-medium leading-tight">
          {attachment.name || "Attachment"}
        </p>
        <p className="truncate text-xs leading-tight text-[var(--faint)]">
          {typeLabel}
        </p>
      </div>

      {attachment.status !== "uploading" && onRemove && (
        <button
          type="button"
          onClick={() => onRemove(attachment.id)}
          aria-label={`Remove ${attachment.name}`}
          className="flex size-5 shrink-0 items-center justify-center rounded-full text-[var(--foreground)] opacity-100 transition-colors hover:bg-[var(--tertiary)] md:opacity-0 md:group-hover:opacity-100"
        >
          <svg
            className="size-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}

      {/* Hover preview */}
      {showPreview && attachment.preview && (
        <div className="absolute bottom-full left-0 mb-2 z-50 w-64 pointer-events-none">
          <div className="rounded-[var(--radius-md)] border border-[var(--outline-border)] bg-[var(--secondary)] p-3 text-left shadow-sm">
            <p className="mb-1 text-[10px] font-medium uppercase text-[var(--faint)]">
              Preview
            </p>
            <p className="text-xs text-[var(--foreground)] line-clamp-4 whitespace-pre-wrap">
              {attachment.preview}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
