import * as React from "react";
import { cn, UI_SCOPE_ATTRS } from "../../theme.ts";
import { ChatTokens } from "../../chat-tokens-style.tsx";
import {
  FileTextIcon,
  MoreHorizontalIcon,
  PaperclipIcon,
  TrashIcon,
  XIcon,
} from "../../../ui/icons/index.ts";
import { Button } from "../../../ui/button.tsx";
import { Skeleton } from "../../../ui/skeleton.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../ui/dropdown-menu.tsx";
import { AttachmentPill, formatSize, useAttachmentPill } from "./attachment-pill.tsx";
import { createStrictContext } from "../../../create-strict-context.ts";
import { isSafeUploadUrl, openSafeUploadUrl } from "../upload-url.ts";

/** Public API contract for uploaded file. */
export interface UploadedFile {
  /** Stable unique id; keys the row and identifies the file in `onRemoveUpload`. */
  id: string;
  /** File name (including extension); shown as the row title. */
  name: string;
  /** File size in bytes; rendered as a compact size label. */
  size?: number;
  /** MIME type (e.g. `application/pdf`); used to pick the icon / preview. */
  type?: string;
  /** Resolved URL for the uploaded file; enables the "Open" overflow action. */
  url?: string;
}

// ---------------------------------------------------------------------------
// AttachmentsPanel — compound, render-or-compose (mirrors `ToolCall` / `Sources`).
//
// `<AttachmentsPanel uploads={…} />` renders the default anatomy: a scrollable
// `AttachmentsPanel.List` of `AttachmentsPanel.Item`s (or the `AttachmentsPanel.Empty`
// state when there are no uploads), plus the upload/attach `AttachmentsPanel.Action`
// when `onAttach` is set. Pass children to recompose from those sub-parts, each
// reading `useAttachmentsPanel()`. Every part takes `className`, merged LAST.
// ---------------------------------------------------------------------------

/** Per-panel state shared with `AttachmentsPanel.*` sub-parts. */
export interface AttachmentsPanelContextValue {
  /** The uploaded files rendered as rows in the panel. */
  uploads: UploadedFile[];
  /** `true` while the initial list is loading; shows the placeholder state. */
  loading?: boolean;
  /** Remove handler, invoked with a file id from the row / overflow menu. */
  onRemoveUpload?: (id: string) => void;
  /** Attach handler, invoked with the picked `FileList` from the upload controls. */
  onAttach?: (files: FileList) => void;
  /** `accept` attribute forwarded to the hidden file input. */
  attachAccept?: string;
  /** Dismisses the panel; enables the close button when set. */
  onClose?: () => void;
  /** Opens the native file picker (wired to the hidden input in `Root`). */
  triggerAttach: () => void;
}

const [AttachmentsPanelContext, useAttachmentsPanelContext] = createStrictContext<
  AttachmentsPanelContextValue
>(
  "useAttachmentsPanel",
  "an AttachmentsPanel",
);

/**
 * Read the panel state provided by `AttachmentsPanel.Root` (uploads + handlers).
 * Use it to build a custom panel part; throws outside an `AttachmentsPanel`.
 *
 * @example
 * ```tsx
 * function UploadCount() {
 *   const { uploads } = useAttachmentsPanel();
 *   return <span>{uploads.length} files</span>;
 * }
 * // <AttachmentsPanel.Root uploads={files}><UploadCount /></AttachmentsPanel.Root>
 * ```
 */
export const useAttachmentsPanel = useAttachmentsPanelContext;

/** Props accepted by `AttachmentsPanel` / `AttachmentsPanel.Root`. */
export interface AttachmentsPanelProps {
  /** Files to list in the panel. Defaults to an empty list (shows `Empty`). */
  uploads?: UploadedFile[];
  /**
   * `true` while the initial list is still loading. When set and there are no
   * uploads yet, the panel shows the `Loading` placeholder instead of `Empty`.
   */
  loading?: boolean;
  /** Remove handler, invoked with a file id from a row / the overflow menu. */
  onRemoveUpload?: (id: string) => void;
  /** Attach handler, invoked with the picked `FileList`; enables the upload controls. */
  onAttach?: (files: FileList) => void;
  /** `accept` attribute forwarded to the hidden file input. */
  attachAccept?: string;
  /** Called to dismiss the panel; renders the header close button when set. */
  onClose?: () => void;
  className?: string;
  /** Compose your own panel; when omitted, the default anatomy is rendered. */
  children?: React.ReactNode;
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;
}

/**
 * `AttachmentsPanel.Root` — context provider + the panel wrapper (scroll area +
 * hidden file input). No children renders the default anatomy (`Empty` when the
 * list is empty, otherwise `List`); pass children to recompose.
 */
function AttachmentsPanelRoot(
  {
    uploads = [],
    loading = false,
    onRemoveUpload,
    onAttach,
    attachAccept,
    onClose,
    className,
    children,
    ref,
  }: AttachmentsPanelProps,
): React.ReactElement {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const triggerAttach = () => fileInputRef.current?.click();

  const context: AttachmentsPanelContextValue = {
    uploads,
    loading,
    onRemoveUpload,
    onAttach,
    attachAccept,
    onClose,
    triggerAttach,
  };

  return (
    <AttachmentsPanelContext.Provider value={context}>
      <ChatTokens />
      <div
        ref={ref}
        {...UI_SCOPE_ATTRS}
        className={cn("flex flex-col h-full", className)}
      >
        {children ?? (
          <>
            {onClose && <AttachmentsPanelHeader />}
            <div className="flex-1 overflow-y-auto px-4 py-4">
              {uploads.length > 0
                ? <AttachmentsPanelList />
                : loading
                ? <AttachmentsPanelLoading />
                : <AttachmentsPanelEmpty />}
            </div>
          </>
        )}
        {onAttach && (
          <input
            ref={fileInputRef}
            type="file"
            accept={attachAccept}
            multiple
            aria-label="Upload file"
            onChange={(e) => {
              if (e.target.files?.length) onAttach(e.target.files);
              e.target.value = "";
            }}
            style={{
              position: "absolute",
              width: 1,
              height: 1,
              padding: 0,
              margin: -1,
              overflow: "hidden",
              clip: "rect(0,0,0,0)",
              whiteSpace: "nowrap",
              border: 0,
            }}
          />
        )}
      </div>
    </AttachmentsPanelContext.Provider>
  );
}
AttachmentsPanelRoot.displayName = "AttachmentsPanel.Root";

/** Props for `AttachmentsPanel.Header` — the title row + close button. */
export interface AttachmentsPanelHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
  /** Compose your own header; when omitted, the "Attachments" title + close. */
  children?: React.ReactNode;
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;
}

/**
 * The panel header: an "Attachments" title with a close `Button` on the right.
 * The close button only appears when `onClose` is set on the panel.
 */
function AttachmentsPanelHeader(
  { className, children, ref, ...props }: AttachmentsPanelHeaderProps,
): React.JSX.Element {
  const { onClose } = useAttachmentsPanel();
  return (
    <div
      ref={ref}
      className={cn(
        "flex shrink-0 items-center justify-between px-4 pt-4",
        className,
      )}
      {...props}
    >
      {children ?? (
        <>
          <h2 className="text-sm font-medium text-[var(--foreground)]">
            Attachments
          </h2>
          {onClose && (
            <Button
              variant="icon-ghost"
              size="icon-sm"
              onClick={onClose}
              aria-label="Close attachments"
            >
              <XIcon className="size-4" />
            </Button>
          )}
        </>
      )}
    </div>
  );
}
AttachmentsPanelHeader.displayName = "AttachmentsPanel.Header";

/** Props for `AttachmentsPanel.List` — the scrollable list of file rows. */
export interface AttachmentsPanelListProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
  /** Compose your own rows; when omitted, one `AttachmentsPanel.Item` per upload. */
  children?: React.ReactNode;
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;
}

/**
 * The attachment list — a flex-gap column of `AttachmentsPanel.Item` cards
 * (one per upload) plus the "Upload files" `AttachmentsPanel.Action` underneath
 * when `onAttach` is set.
 */
function AttachmentsPanelList(
  { className, children, ref, ...props }: AttachmentsPanelListProps,
): React.JSX.Element {
  const { uploads, onAttach } = useAttachmentsPanel();
  return (
    <div ref={ref} className={cn("mx-auto flex max-w-2xl flex-col gap-2", className)} {...props}>
      {children ?? (
        <>
          {uploads.map((doc) => <AttachmentsPanelItem key={doc.id} file={doc} />)}
          {onAttach && <AttachmentsPanelAction variant="more" />}
        </>
      )}
    </div>
  );
}
AttachmentsPanelList.displayName = "AttachmentsPanel.List";

/** Props accepted by an individual `AttachmentsPanel.Item` (attachment card). */
export interface AttachmentsPanelItemProps {
  /** The uploaded file this row renders. */
  file: UploadedFile;
  className?: string;
  /**
   * Compose the row from the `AttachmentsPanel.Item.*` leaves (`.Icon` /
   * `.Preview` / `.Name` / `.Size` / `.Remove`), the `AttachmentPill.*` parts
   * (e.g. `.Label`), or your own text read from `useAttachmentPill()`. Omit for
   * the default card (media + label + overflow menu).
   */
  children?: React.ReactNode;
  /** React 19: ref is a regular prop (threaded to the underlying `AttachmentPill`). */
  ref?: React.Ref<HTMLDivElement>;
}

/**
 * A single attachment row — the shared `Attachment` (`AttachmentPill`) card,
 * stretched full-width. This *composes* `AttachmentPill` (rather than rendering
 * its default anatomy) to swap the trailing remove (✕) for an overflow (⋯) menu
 * with Open / Delete — a live test of how composable `Attachment` is. Pass
 * children to recompose the row from the `AttachmentsPanel.Item.*` leaves.
 */
function AttachmentsPanelItem(
  { file: doc, className, children, ref }: AttachmentsPanelItemProps,
): React.JSX.Element {
  return (
    // Borderless rows here — the panel is a plain list, not a field of chips.
    // The `AttachmentPill` provides the per-item context the `Item.*` leaves read.
    <AttachmentPill ref={ref} attachment={doc} bordered={false} className={cn("w-full", className)}>
      {children ?? (
        <>
          <AttachmentsPanelItemMedia />
          <AttachmentPill.Label />
          <AttachmentsPanelItemMenu file={doc} />
        </>
      )}
    </AttachmentPill>
  );
}

/**
 * The leading media square — reads the pill's derived state to show the image
 * `Thumbnail` (image attachments) or the file-type `Icon`, matching the default
 * anatomy's choice.
 */
function AttachmentsPanelItemMedia(
  { className }: { className?: string },
): React.JSX.Element {
  const { imageSrc, isError } = useAttachmentPill();
  return imageSrc && !isError
    ? <AttachmentPill.Thumbnail className={className} />
    : <AttachmentPill.Icon className={className} />;
}

// ---------------------------------------------------------------------------
// AttachmentsPanel.Item.* — the row leaves: `.Icon` / `.Preview` (derived pill
// state), `.Name` / `.Size` (the file's text lines), and `.Remove` (bound to
// the panel's `onRemoveUpload`). Each reads the item's file from the enclosing
// `AttachmentPill` context. Use these inside an `AttachmentsPanel.Item`.
// ---------------------------------------------------------------------------

/** `AttachmentsPanel.Item.Icon` — the file-type icon square. */
function AttachmentsPanelItemIcon(
  { className, ref, ...props }:
    & React.HTMLAttributes<HTMLDivElement>
    & { ref?: React.Ref<HTMLDivElement> },
): React.JSX.Element {
  return <AttachmentPill.Icon ref={ref} className={className} {...props} />;
}
AttachmentsPanelItemIcon.displayName = "AttachmentsPanel.Item.Icon";

/**
 * `AttachmentsPanel.Item.Preview` — the image thumbnail. Renders nothing when
 * the file isn't an image (fall back to `AttachmentsPanel.Item.Icon`).
 */
function AttachmentsPanelItemPreview(
  { className, ref, ...props }:
    & React.HTMLAttributes<HTMLDivElement>
    & { ref?: React.Ref<HTMLDivElement> },
): React.JSX.Element | null {
  const { imageSrc, isError } = useAttachmentPill();
  if (!imageSrc || isError) return null;
  return <AttachmentPill.Thumbnail ref={ref} className={className} {...props} />;
}
AttachmentsPanelItemPreview.displayName = "AttachmentsPanel.Item.Preview";

/**
 * `AttachmentsPanel.Item.Name` — the file-name line. Deliberately plain text:
 * unlike `AttachmentPill.Label`, it does not wrap the name in a shimmer while
 * the attachment uploads. Compose `AttachmentPill.Label` for that treatment.
 */
function AttachmentsPanelItemName(
  { className, ref, ...props }:
    & React.HTMLAttributes<HTMLParagraphElement>
    & { ref?: React.Ref<HTMLParagraphElement> },
): React.JSX.Element {
  const { attachment } = useAttachmentPill();
  return (
    <p
      ref={ref}
      className={cn("truncate text-sm font-medium leading-tight", className)}
      {...props}
    >
      {attachment.name || "Attachment"}
    </p>
  );
}
AttachmentsPanelItemName.displayName = "AttachmentsPanel.Item.Name";

/**
 * `AttachmentsPanel.Item.Size` — the human-formatted byte label (`formatSize`).
 * Renders nothing when the file has no size. Always the faint secondary color;
 * the error/destructive state line stays with `AttachmentPill.Label`.
 */
function AttachmentsPanelItemSize(
  { className, ref, ...props }:
    & React.HTMLAttributes<HTMLParagraphElement>
    & { ref?: React.Ref<HTMLParagraphElement> },
): React.JSX.Element | null {
  const { attachment } = useAttachmentPill();
  if (attachment.size == null) return null;
  return (
    <p
      ref={ref}
      className={cn("truncate text-xs leading-tight text-[var(--faint)]", className)}
      {...props}
    >
      {formatSize(attachment.size)}
    </p>
  );
}
AttachmentsPanelItemSize.displayName = "AttachmentsPanel.Item.Size";

/** Props for `AttachmentsPanel.Item.Remove`. */
export interface AttachmentsPanelItemRemoveProps {
  className?: string;
  /** Replace the default glyph. The canonical path (RFC 2980: a leaf renders its
   * default icon when childless; pass children to replace it). */
  children?: React.ReactNode;
  icon?: React.ReactNode;
  /** React 19: ref is a regular prop (threaded to the button). */
  ref?: React.Ref<HTMLButtonElement>;
}

/**
 * `AttachmentsPanel.Item.Remove` — the delete control, wired to the panel's
 * `onRemoveUpload` for this item. Renders nothing when no remove handler is set.
 */
function AttachmentsPanelItemRemove(
  { className, children, icon, ref }: AttachmentsPanelItemRemoveProps,
): React.JSX.Element | null {
  const { attachment } = useAttachmentPill();
  const { onRemoveUpload } = useAttachmentsPanel();
  if (!onRemoveUpload) return null;
  return (
    <Button
      ref={ref}
      type="button"
      variant="icon-ghost"
      size="icon-sm"
      on="card"
      onClick={() => onRemoveUpload(attachment.id)}
      aria-label={`Remove ${attachment.name}`}
      className={cn("shrink-0", className)}
    >
      {children ?? icon ?? <TrashIcon />}
    </Button>
  );
}
AttachmentsPanelItemRemove.displayName = "AttachmentsPanel.Item.Remove";

/** `AttachmentsPanel.Item` compound — the row plus its addressable leaves. */
const AttachmentsPanelItemCompound = Object.assign(AttachmentsPanelItem, {
  Icon: AttachmentsPanelItemIcon,
  Preview: AttachmentsPanelItemPreview,
  Name: AttachmentsPanelItemName,
  Size: AttachmentsPanelItemSize,
  Remove: AttachmentsPanelItemRemove,
});
AttachmentsPanelItem.displayName = "AttachmentsPanel.Item";

/**
 * The trailing overflow (⋯) menu — Open (when the file has a url) and Delete
 * (when `onRemoveUpload` is set). Replaces the pill's default ✕ control.
 */
function AttachmentsPanelItemMenu(
  { file }: { file: UploadedFile },
): React.JSX.Element | null {
  const { onRemoveUpload } = useAttachmentsPanel();
  const canOpen = isSafeUploadUrl(file.url);
  if (!canOpen && !onRemoveUpload) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="icon-ghost"
          size="icon-sm"
          on="card"
          aria-label={`Actions for ${file.name}`}
          className="shrink-0"
        >
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {canOpen && (
          <DropdownMenuItem
            onClick={(event) => {
              const ownerDocument = event.currentTarget.ownerDocument;
              openSafeUploadUrl(file.url, ownerDocument);
            }}
          >
            <FileTextIcon />
            Open
          </DropdownMenuItem>
        )}
        {onRemoveUpload && (
          <DropdownMenuItem
            onSelect={() => onRemoveUpload(file.id)}
            className="text-[var(--destructive)] focus:text-[var(--destructive)]"
          >
            <TrashIcon />
            Delete
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Props for `AttachmentsPanel.Loading` — the initial-fetch placeholder. */
export interface AttachmentsPanelLoadingProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
  /** How many skeleton rows to render. Default `3`. */
  count?: number;
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;
}

/**
 * The loading state: skeleton rows shaped like `AttachmentsPanel.Item` cards,
 * shown while the initial list is fetched so the panel doesn't flash `Empty`.
 */
function AttachmentsPanelLoading(
  { className, count = 3, ref, ...props }: AttachmentsPanelLoadingProps,
): React.JSX.Element {
  return (
    <div
      ref={ref}
      className={cn("mx-auto flex max-w-2xl flex-col gap-2", className)}
      aria-busy="true"
      aria-live="polite"
      aria-label="Loading files"
      {...props}
    >
      {Array.from(
        { length: count },
        (_, i) => (
          <div key={i} className="flex w-full items-center gap-3 py-1">
            {/* Bare skeleton shapes — no card surface, just the shimmer. */}
            <Skeleton className="size-10 shrink-0 rounded-[var(--radius-sm)]" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-1/2" />
              <Skeleton className="h-3 w-1/4" />
            </div>
          </div>
        ),
      )}
    </div>
  );
}
AttachmentsPanelLoading.displayName = "AttachmentsPanel.Loading";

/** Props for `AttachmentsPanel.Empty` — the no-files state. */
export interface AttachmentsPanelEmptyProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
  /** Compose your own empty state; when omitted, the default copy + action. */
  children?: React.ReactNode;
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;
}

/** The empty state: heading, hint, and the upload `AttachmentsPanel.Action`. */
function AttachmentsPanelEmpty(
  { className, children, ref, ...props }: AttachmentsPanelEmptyProps,
): React.JSX.Element {
  const { onAttach } = useAttachmentsPanel();
  return (
    <div
      ref={ref}
      className={cn(
        "flex flex-col items-center justify-center h-full text-center",
        className,
      )}
      {...props}
    >
      {children ?? (
        <>
          <div className="mb-4 flex size-14 items-center justify-center rounded-full bg-[var(--secondary)] text-[var(--faint)]">
            <PaperclipIcon className="size-6" />
          </div>
          <h1 className="text-base font-medium text-[var(--foreground)]">
            No files uploaded
          </h1>
          <p className="mt-1 max-w-xs text-sm leading-6 text-[var(--faint)]">
            Upload files to start asking questions about them
          </p>
          {onAttach && (
            <AttachmentsPanelAction variant="empty">
              Upload files
            </AttachmentsPanelAction>
          )}
        </>
      )}
    </div>
  );
}
AttachmentsPanelEmpty.displayName = "AttachmentsPanel.Empty";

/** Props for `AttachmentsPanel.Action` — the upload/attach button. */
export interface AttachmentsPanelActionProps {
  /**
   * Presentation only: `empty` is the pill button in the empty state, `more` is
   * the centered "add more" button below the list. Both render a `<Button>`
   * labelled "Upload files". Defaults to `empty`.
   */
  variant?: "empty" | "more";
  className?: string;
  /** Button contents; defaults to "Upload files". */
  children?: React.ReactNode;
  /** Called after opening the native picker. */
  onClick?: () => void;
  /** React 19: ref is a regular prop (threaded to the button). */
  ref?: React.Ref<HTMLButtonElement>;
}

/** The upload/attach button. Opens the native file picker wired in `Root`. */
function AttachmentsPanelAction(
  { variant = "empty", className, children, onClick, ref }: AttachmentsPanelActionProps,
): React.JSX.Element {
  const { triggerAttach } = useAttachmentsPanel();
  const handleClick = () => {
    triggerAttach();
    onClick?.();
  };
  return variant === "more"
    ? (
      <div className="flex justify-center pt-2">
        <Button
          ref={ref}
          variant="primary"
          onClick={handleClick}
          className={cn("shadow-sm", className)}
        >
          {children ?? "Upload files"}
        </Button>
      </div>
    )
    : (
      <Button
        ref={ref}
        variant="primary"
        onClick={handleClick}
        className={cn("mt-4 shadow-sm", className)}
      >
        {children ?? "Upload files"}
      </Button>
    );
}
AttachmentsPanelAction.displayName = "AttachmentsPanel.Action";

/**
 * AttachmentsPanel — render `<AttachmentsPanel uploads={…} />` for the default panel, or
 * compose `AttachmentsPanel.Root` + `List` / `Item` / `Empty` / `Action` for a
 * custom layout. Mirrors the `ToolCall` / `Sources` compounds: render it, or
 * compose it.
 */
export const AttachmentsPanel = Object.assign(AttachmentsPanelRoot, {
  Root: AttachmentsPanelRoot,
  Header: AttachmentsPanelHeader,
  List: AttachmentsPanelList,
  Item: AttachmentsPanelItemCompound,
  Loading: AttachmentsPanelLoading,
  Empty: AttachmentsPanelEmpty,
  Action: AttachmentsPanelAction,
});
