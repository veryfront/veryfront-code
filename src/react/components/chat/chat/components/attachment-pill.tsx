import * as React from "react";
import { cn } from "../../theme.ts";
import { CheckIcon, ClockIcon, FileTextIcon, RefreshCwIcon } from "../../icons/index.ts";
import { Button } from "../../ui/button.tsx";
import { Shimmer } from "./animations.tsx";
import { COMPONENT_ERROR } from "#veryfront/errors/error-registry.ts";

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

/** Icon overrides for {@link AttachmentPill}. Each defaults to its glyph. */
export interface AttachmentPillIcons {
  /** Override the remove (✕) glyph. */
  remove?: React.ReactNode;
  /** Override the retry glyph. */
  retry?: React.ReactNode;
}

/** Props accepted by attachment pill. */
export interface AttachmentPillProps extends React.HTMLAttributes<HTMLDivElement> {
  attachment: AttachmentInfo;
  onRemove?: (id: string) => void;
  /** Retry handler — surfaces a retry button in the `error` state. */
  onRetry?: (id: string) => void;
  /** Override the remove / retry button icons. */
  icons?: AttachmentPillIcons;
  /** Compose your own pill; when omitted, the default anatomy is rendered. */
  children?: React.ReactNode;
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
  return ext ? ext.toUpperCase() : (mediaType || "File");
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
      return attachment.size != null ? `Uploaded · ${formatSize(attachment.size)}` : "Uploaded";
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

// ---------------------------------------------------------------------------
// AttachmentPill — compound, render-or-compose (mirrors `ToolCall` / `Sources`).
//
// `<AttachmentPill attachment={…} />` renders the default anatomy: a
// `Thumbnail` (image) or `Icon` (glyph / ext box), a `Label` column, then the
// optional `Retry` / `Remove` controls. Pass children to recompose from
// `AttachmentPill.Thumbnail` / `.Icon` / `.Label` / `.Retry` / `.Remove`, each
// reading `useAttachmentPill()`. Every part takes `className` (merged LAST).
// ---------------------------------------------------------------------------

/** Derived per-pill view state shared with `AttachmentPill.*` sub-parts. */
export interface AttachmentPillContextValue {
  attachment: AttachmentInfo;
  onRemove?: (id: string) => void;
  onRetry?: (id: string) => void;
  icons?: AttachmentPillIcons;
  /** File extension (from the name, falling back to the media type). */
  ext: string;
  /** Tailwind color pair for the default (no-state) icon box. */
  colorClass: string;
  /** Whether the attachment resolves to an image. */
  isImage: boolean;
  /** The image `src` to show in the thumbnail (preview → url). */
  imageSrc?: string;
  /** Whether the current state is `error`. */
  isError: boolean;
  /** Whether a spinner overlay should show (uploading / processing). */
  isBusy: boolean;
  /** Whether the title should shimmer (uploading / processing). */
  shimmerTitle: boolean;
  /** The secondary label line for the current state. */
  label: string;
  /** Legacy dimming for the old `status="uploading"` API. */
  legacyUploading: boolean;
  /** Whether the remove control should render. */
  showRemove: boolean;
  /** The state glyph for the icon box (null → render the extension text). */
  stateGlyph: React.ReactNode;
  /** Tailwind classes for the icon box background/foreground. */
  boxClass: string;
}

const AttachmentPillContext = React.createContext<
  AttachmentPillContextValue | null
>(null);

/**
 * Read the enclosing `AttachmentPill` state. Throws when used outside an
 * `AttachmentPill`.
 */
export function useAttachmentPill(): AttachmentPillContextValue {
  const ctx = React.useContext(AttachmentPillContext);
  if (!ctx) {
    throw COMPONENT_ERROR.create({
      detail: "useAttachmentPill must be used within a AttachmentPill",
    });
  }
  return ctx;
}

/**
 * `AttachmentPill.Root` — context provider + the chip wrapper. No children
 * renders the default anatomy; pass children to recompose.
 */
const AttachmentPillRoot = React.forwardRef<
  HTMLDivElement,
  AttachmentPillProps
>(function AttachmentPill({
  attachment,
  onRemove,
  onRetry,
  icons,
  className,
  children,
  ...props
}, ref): React.ReactElement {
  const mediaType = attachment.type ?? "";
  const ext = getExtension(attachment.name) ||
    mediaType.split("/").pop()?.toLowerCase() || "";
  const colorClass = FILE_TYPE_COLORS[ext] ??
    "text-[var(--faint)] bg-[var(--tertiary)]";
  const isImage = mediaType.startsWith("image/") ||
    /\.(avif|gif|jpe?g|png|webp)$/i.test(attachment.name);

  const state = attachment.state;
  const isError = state === "error";
  // Prefer the local object-URL `preview`; fall back to the resolved `url`
  // (set on sent-message pills) so an uploaded image still shows a thumbnail.
  const imageSrc = isImage ? (attachment.preview ?? attachment.url) : undefined;
  const isBusy = state === "uploading" || state === "processing" ||
    attachment.status === "uploading";
  const shimmerTitle = state === "uploading" || state === "processing";
  const label = getStateLabel(attachment, ext, mediaType);
  // Legacy dimming only applies to the old `status` API (new states stay solid).
  const legacyUploading = !state && attachment.status === "uploading";
  const showRemove = Boolean(onRemove) &&
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

  const context: AttachmentPillContextValue = {
    attachment,
    onRemove,
    onRetry,
    icons,
    ext,
    colorClass,
    isImage,
    imageSrc,
    isError,
    isBusy,
    shimmerTitle,
    label,
    legacyUploading,
    showRemove,
    stateGlyph,
    boxClass,
  };

  return (
    <AttachmentPillContext.Provider value={context}>
      <div
        {...props}
        ref={ref}
        className={cn(
          // No width here on purpose — width is the container's decision
          // (composer uses a fixed chip, AttachmentsPanel fills the row).
          "group relative flex items-center gap-3 rounded-[var(--radius-md)] border bg-[var(--secondary)] py-1 pl-1 pr-2 text-[var(--foreground)]",
          state === "selected"
            ? "border-dashed border-[var(--edge-medium)]"
            : isError
            ? "border-[var(--destructive)] bg-[color-mix(in_oklch,var(--destructive),transparent_94%)]"
            : "border-[var(--edge-medium)]",
          legacyUploading && "opacity-70",
          className,
        )}
      >
        {children ?? (
          <>
            {imageSrc && !isError ? <AttachmentPillThumbnail /> : <AttachmentPillIcon />}
            <AttachmentPillLabel />
            <AttachmentPillRetry />
            <AttachmentPillRemove />
          </>
        )}
      </div>
    </AttachmentPillContext.Provider>
  );
});
AttachmentPillRoot.displayName = "AttachmentPill.Root";

/**
 * `AttachmentPill.Thumbnail` — the image square (with a busy overlay). Renders
 * only when the attachment resolves to a non-error image with a source.
 */
function AttachmentPillThumbnail(
  { className }: { className?: string },
): React.JSX.Element | null {
  const { imageSrc, isError, isBusy } = useAttachmentPill();
  if (!imageSrc || isError) return null;
  return (
    <div
      className={cn(
        "relative size-10 shrink-0 overflow-hidden rounded-[var(--radius-sm)] bg-[var(--tertiary)]",
        className,
      )}
    >
      <img
        alt=""
        className="size-full object-cover"
        src={imageSrc}
      />
      {isBusy && (
        <div className="absolute inset-0 flex items-center justify-center rounded-[var(--radius-sm)] bg-[var(--overlay)]">
          <span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
        </div>
      )}
    </div>
  );
}
AttachmentPillThumbnail.displayName = "AttachmentPill.Thumbnail";

/**
 * `AttachmentPill.Icon` — the state-glyph / file-extension square shown when
 * there is no image thumbnail.
 */
function AttachmentPillIcon(
  { className }: { className?: string },
): React.JSX.Element {
  const { boxClass, stateGlyph, ext, legacyUploading } = useAttachmentPill();
  return (
    <div
      className={cn(
        "relative flex size-10 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[10px] font-medium uppercase leading-none",
        boxClass,
        className,
      )}
    >
      {stateGlyph ?? ext ?? "file"}
      {legacyUploading && (
        <div className="absolute inset-0 flex items-center justify-center rounded-[var(--radius-sm)] bg-[var(--overlay)]">
          <span className="size-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
        </div>
      )}
    </div>
  );
}
AttachmentPillIcon.displayName = "AttachmentPill.Icon";

/** `AttachmentPill.Label` — the name + secondary state-line column. */
function AttachmentPillLabel(
  { className }: { className?: string },
): React.JSX.Element {
  const { attachment, shimmerTitle, isError, label } = useAttachmentPill();
  return (
    <div
      className={cn("flex min-w-0 flex-1 flex-col gap-0.5", className)}
    >
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
  );
}
AttachmentPillLabel.displayName = "AttachmentPill.Label";

/**
 * `AttachmentPill.Retry` — the retry control. Renders only in the `error` state
 * when an `onRetry` handler is provided.
 */
function AttachmentPillRetry(
  { className }: { className?: string },
): React.JSX.Element | null {
  const { attachment, isError, onRetry, icons } = useAttachmentPill();
  if (!isError || !onRetry) return null;
  return (
    <Button
      type="button"
      variant="icon-ghost"
      size="icon-xs"
      on="card"
      onClick={() => onRetry(attachment.id)}
      aria-label={`Retry ${attachment.name}`}
      className={cn("shrink-0", className)}
    >
      {icons?.retry ?? <RefreshCwIcon />}
    </Button>
  );
}
AttachmentPillRetry.displayName = "AttachmentPill.Retry";

/**
 * `AttachmentPill.Remove` — the remove (✕) control. Renders only when an
 * `onRemove` handler is provided and the pill isn't a legacy uploading pill.
 */
function AttachmentPillRemove(
  { className }: { className?: string },
): React.JSX.Element | null {
  const { attachment, showRemove, onRemove, icons } = useAttachmentPill();
  if (!showRemove) return null;
  return (
    <Button
      type="button"
      variant="icon-ghost"
      size="icon-xs"
      on="card"
      onClick={() => onRemove?.(attachment.id)}
      aria-label={`Remove ${attachment.name}`}
      className={cn(
        "shrink-0 opacity-100 md:opacity-0 md:group-hover:opacity-100",
        className,
      )}
    >
      {icons?.remove ?? (
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
      )}
    </Button>
  );
}
AttachmentPillRemove.displayName = "AttachmentPill.Remove";

/**
 * AttachmentPill — render `<AttachmentPill attachment={…} />` for the default
 * chip, or compose `AttachmentPill.Root` + `.Thumbnail` / `.Icon` / `.Label` /
 * `.Retry` / `.Remove` for a custom layout. Publicly aliased as `Attachment`.
 */
export const AttachmentPill = Object.assign(AttachmentPillRoot, {
  Root: AttachmentPillRoot,
  Thumbnail: AttachmentPillThumbnail,
  Icon: AttachmentPillIcon,
  Label: AttachmentPillLabel,
  Retry: AttachmentPillRetry,
  Remove: AttachmentPillRemove,
});
