import * as React from "react";
import { cn } from "../../theme.ts";
import {
  CheckIcon,
  ClockIcon,
  FileTextIcon,
  RefreshCwIcon,
} from "../../icons/index.ts";
import { Button } from "../../ui/button.tsx";
import { Shimmer } from "./animations.tsx";

/** Upload lifecycle state (shadcn-style). Drives the icon, label, and treatment. */
export type AttachmentState =
  | "selected"
  | "uploading"
  | "processing"
  | "uploaded"
  | "error";

/** Public API contract for attachment info. */
export interface AttachmentInfo {
  id: string;
  name: string;
  /** Legacy two-value status; prefer `state` for the full lifecycle. */
  status?: "uploading" | "ready";
  /** Upload lifecycle state — sets the icon, label, and container treatment. */
  state?: AttachmentState;
  /** Upload progress (0–100), shown in the `uploading` label. */
  progress?: number;
  type?: string;
  size?: number;
  preview?: string;
  /** Resolved URL once the file has finished uploading. */
  url?: string;
}

/** Props accepted by attachment pill. */
export interface AttachmentPillProps {
  attachment: AttachmentInfo;
  onRemove?: (id: string) => void;
  /** Retry handler — surfaces a retry button in the `error` state. */
  onRetry?: (id: string) => void;
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

/** Secondary line for the current lifecycle state. */
function getStateLabel(
  attachment: AttachmentInfo,
  ext: string,
  mediaType: string,
): string {
  switch (attachment.state) {
    case "selected":
      return "Ready to upload";
    case "uploading":
      return attachment.progress != null
        ? `Uploading · ${Math.round(attachment.progress)}%`
        : "Uploading";
    case "processing":
      return "Processing document";
    case "uploaded":
      return attachment.size != null
        ? `Uploaded · ${formatSize(attachment.size)}`
        : "Uploaded";
    case "error":
      return "Upload failed. Try again.";
    default:
      return getTypeLabel(attachment, ext, mediaType);
  }
}

/** A rounded spinner used while uploading. */
function Spinner(): React.ReactElement {
  return (
    <span className="size-4.5 animate-spin rounded-full border-2 border-[var(--faint)] border-t-transparent" />
  );
}

/** Alert glyph for the error state (no dedicated icon in the barrel). */
function AlertGlyph(): React.ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-4.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="8" x2="12" y2="12.5" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

/** Render attachment pill. */
export function AttachmentPill({
  attachment,
  onRemove,
  onRetry,
}: AttachmentPillProps): React.ReactElement {
  const [showPreview, setShowPreview] = React.useState(false);
  const mediaType = attachment.type ?? "";
  const ext = getExtension(attachment.name) ||
    mediaType.split("/").pop()?.toLowerCase() || "";
  const colorClass = FILE_TYPE_COLORS[ext] ??
    "text-[var(--faint)] bg-[var(--tertiary)]";
  const isImage = mediaType.startsWith("image/") ||
    /\.(avif|gif|jpe?g|png|webp)$/i.test(attachment.name);

  const state = attachment.state;
  const isError = state === "error";
  const shimmerTitle = state === "uploading" || state === "processing";
  const label = getStateLabel(attachment, ext, mediaType);
  // Legacy dimming only applies to the old `status` API (new states stay solid).
  const legacyUploading = !state && attachment.status === "uploading";
  const showRemove = onRemove &&
    (Boolean(state) || attachment.status !== "uploading");

  // The left box shows a state glyph when a lifecycle `state` is set, otherwise
  // the file-type extension badge (default behaviour).
  const stateGlyph = state === "selected"
    ? <ClockIcon className="size-4.5 text-[var(--faint)]" />
    : state === "uploading"
    ? <Spinner />
    : state === "processing"
    ? <FileTextIcon className="size-4.5 text-[var(--faint)]" />
    : state === "uploaded"
    ? <CheckIcon className="size-4.5 text-[var(--foreground)]" />
    : isError
    ? <AlertGlyph />
    : null;

  const boxClass = isError
    ? "bg-[color-mix(in_oklch,var(--destructive),transparent_86%)] text-[var(--destructive)]"
    : state
    ? "bg-[var(--tertiary)] text-[var(--foreground)]"
    : colorClass;

  return (
    <div
      className={cn(
        "group relative flex w-[200px] items-center gap-3 rounded-[var(--radius-md)] border bg-[var(--secondary)] py-1 pl-1 pr-2 text-[var(--foreground)]",
        state === "selected"
          ? "border-dashed border-[var(--edge-medium)]"
          : isError
          ? "border-[var(--destructive)] bg-[color-mix(in_oklch,var(--destructive),transparent_94%)]"
          : "border-[var(--edge-medium)]",
        legacyUploading && "opacity-70",
      )}
      onMouseEnter={() => setShowPreview(true)}
      onMouseLeave={() => setShowPreview(false)}
    >
      {isImage && attachment.preview && !state
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
              boxClass,
            )}
          >
            {stateGlyph ?? ext ?? "file"}
            {legacyUploading && (
              <div className="absolute inset-0 flex items-center justify-center rounded-[var(--radius-sm)] bg-[var(--overlay)]">
                <span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
              </div>
            )}
          </div>
        )}

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="truncate text-sm font-medium leading-tight">
          {shimmerTitle
            ? <Shimmer>{attachment.name || "Attachment"}</Shimmer>
            : (attachment.name || "Attachment")}
        </p>
        <p
          className={cn(
            "truncate text-xs leading-tight",
            isError ? "text-[var(--destructive)]" : "text-[var(--faint)]",
          )}
        >
          {label}
        </p>
      </div>

      {isError && onRetry && (
        <Button
          type="button"
          variant="icon-ghost"
          size="icon-xs"
          on="card"
          onClick={() => onRetry(attachment.id)}
          aria-label={`Retry ${attachment.name}`}
          className="shrink-0"
        >
          <RefreshCwIcon />
        </Button>
      )}

      {showRemove && (
        <Button
          type="button"
          variant="icon-ghost"
          size="icon-xs"
          on="card"
          onClick={() => onRemove?.(attachment.id)}
          aria-label={`Remove ${attachment.name}`}
          className="shrink-0 opacity-100 md:opacity-0 md:group-hover:opacity-100"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </Button>
      )}

      {/* Hover preview */}
      {showPreview && attachment.preview && (
        <div className="absolute bottom-full left-0 mb-2 z-50 w-64 pointer-events-none">
          <div className="rounded-lg bg-[var(--popover)] p-3 text-left shadow-sm">
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
