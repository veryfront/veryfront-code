import * as React from "react";
import { cn } from "../../theme.ts";

export interface AttachmentInfo {
  id: string;
  name: string;
  status?: "uploading" | "ready";
  type?: string;
  size?: number;
  preview?: string;
}

export interface AttachmentPillProps {
  attachment: AttachmentInfo;
  onRemove?: (id: string) => void;
}

const FILE_TYPE_COLORS: Record<string, string> = {
  pdf: "text-red-500 bg-red-500/10",
  docx: "text-blue-500 bg-blue-500/10",
  csv: "text-emerald-500 bg-emerald-500/10",
  txt: "text-neutral-500 bg-neutral-500/10",
  md: "text-purple-500 bg-purple-500/10",
  mdx: "text-purple-500 bg-purple-500/10",
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

export function AttachmentPill({
  attachment,
  onRemove,
}: AttachmentPillProps): React.ReactElement {
  const [showPreview, setShowPreview] = React.useState(false);
  const ext = attachment.type ?? getExtension(attachment.name);
  const colorClass = FILE_TYPE_COLORS[ext] ?? "text-neutral-400 bg-neutral-400/10";

  return (
    <span
      className="relative inline-flex items-center gap-1.5 pl-2.5 pr-1.5 py-1 rounded-lg bg-neutral-200/60 dark:bg-neutral-700/60 text-xs text-neutral-700 dark:text-neutral-300"
      onMouseEnter={() => setShowPreview(true)}
      onMouseLeave={() => setShowPreview(false)}
    >
      {/* File type badge */}
      <span
        className={cn(
          "inline-flex items-center justify-center rounded px-1 py-0.5 text-[9px] font-bold uppercase leading-none",
          colorClass,
        )}
      >
        {ext || "?"}
      </span>

      <span className="truncate max-w-[120px]">{attachment.name}</span>

      {attachment.size != null && (
        <span className="text-[10px] text-neutral-400 dark:text-neutral-500 shrink-0">
          {formatSize(attachment.size)}
        </span>
      )}

      {attachment.status === "uploading"
        ? (
          <span className="size-3 shrink-0 rounded-full border-2 border-neutral-400 border-t-transparent animate-spin" />
        )
        : onRemove && (
          <button
            type="button"
            onClick={() => onRemove(attachment.id)}
            aria-label={`Remove ${attachment.name}`}
            className="size-4 shrink-0 flex items-center justify-center rounded-full hover:bg-neutral-300 dark:hover:bg-neutral-600 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 transition-colors"
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
          <div className="bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl shadow-lg p-3 text-left">
            <p className="text-[10px] font-medium text-neutral-500 dark:text-neutral-400 uppercase mb-1">
              Preview
            </p>
            <p className="text-xs text-neutral-600 dark:text-neutral-300 line-clamp-4 whitespace-pre-wrap">
              {attachment.preview}
            </p>
          </div>
        </div>
      )}
    </span>
  );
}
