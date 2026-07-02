import * as React from "react";
import { cn } from "../../theme.ts";
import { FileTextIcon, TrashIcon, XIcon } from "../../icons/index.ts";
import { Button } from "../../ui/button.tsx";
import { COMPONENT_ERROR } from "#veryfront/errors/error-registry.ts";

/** Public API contract for uploaded file. */
export interface UploadedFile {
  id: string;
  name: string;
  size?: number;
  type?: string;
  url?: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// UploadsPanel — compound, render-or-compose (mirrors `ToolCall` / `Sources`).
//
// `<UploadsPanel uploads={…} />` renders the default anatomy: a scrollable
// `UploadsPanel.List` of `UploadsPanel.Item`s (or the `UploadsPanel.Empty`
// state when there are no uploads), plus the upload/attach `UploadsPanel.Action`
// when `onAttach` is set. Pass children to recompose from those sub-parts, each
// reading `useUploadsPanel()`. Every part takes `className`, merged LAST.
// ---------------------------------------------------------------------------

/** Per-panel state shared with `UploadsPanel.*` sub-parts. */
export interface UploadsPanelContextValue {
  uploads: UploadedFile[];
  onRemoveUpload?: (id: string) => void;
  onAttach?: (files: FileList) => void;
  attachAccept?: string;
  /** Dismisses the panel; enables the close button when set. */
  onClose?: () => void;
  /** Opens the native file picker (wired to the hidden input in `Root`). */
  triggerAttach: () => void;
}

const UploadsPanelContext = React.createContext<
  UploadsPanelContextValue | null
>(null);

/**
 * Read the enclosing `UploadsPanel` state. Throws when used outside an
 * `UploadsPanel`.
 */
export function useUploadsPanel(): UploadsPanelContextValue {
  const ctx = React.useContext(UploadsPanelContext);
  if (!ctx) {
    throw COMPONENT_ERROR.create({
      detail: "useUploadsPanel must be used within an UploadsPanel",
    });
  }
  return ctx;
}

/** Props accepted by `UploadsPanel` / `UploadsPanel.Root`. */
export interface UploadsPanelProps {
  uploads?: UploadedFile[];
  onRemoveUpload?: (id: string) => void;
  onAttach?: (files: FileList) => void;
  attachAccept?: string;
  /** Called to dismiss the panel; renders the header close button when set. */
  onClose?: () => void;
  className?: string;
  /** Compose your own panel; when omitted, the default anatomy is rendered. */
  children?: React.ReactNode;
}

/**
 * `UploadsPanel.Root` — context provider + the panel wrapper (scroll area +
 * hidden file input). No children renders the default anatomy (`Empty` when the
 * list is empty, otherwise `List`); pass children to recompose.
 */
const UploadsPanelRoot = React.forwardRef<HTMLDivElement, UploadsPanelProps>(
  function UploadsPanel(
    {
      uploads = [],
      onRemoveUpload,
      onAttach,
      attachAccept,
      onClose,
      className,
      children,
    },
    ref,
  ) {
    const fileInputRef = React.useRef<HTMLInputElement>(null);
    const triggerAttach = () => fileInputRef.current?.click();

    const context: UploadsPanelContextValue = {
      uploads,
      onRemoveUpload,
      onAttach,
      attachAccept,
      onClose,
      triggerAttach,
    };

    return (
      <UploadsPanelContext.Provider value={context}>
        <div ref={ref} className={cn("flex flex-col h-full", className)}>
          {children ?? (
            <>
              {onClose && <UploadsPanelHeader />}
              <div className="flex-1 overflow-y-auto px-4 py-4">
                {uploads.length === 0 ? <UploadsPanelEmpty /> : <UploadsPanelList />}
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
      </UploadsPanelContext.Provider>
    );
  },
);
UploadsPanelRoot.displayName = "UploadsPanel.Root";

/** Props for `UploadsPanel.Header` — the title row + close button. */
export interface UploadsPanelHeaderProps {
  className?: string;
  /** Compose your own header; when omitted, the "Attachments" title + close. */
  children?: React.ReactNode;
}

/**
 * The panel header: an "Attachments" title with a close `Button` on the right.
 * The close button only appears when `onClose` is set on the panel.
 */
function UploadsPanelHeader(
  { className, children }: UploadsPanelHeaderProps,
): React.JSX.Element {
  const { onClose } = useUploadsPanel();
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-between px-4 pt-4",
        className,
      )}
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
UploadsPanelHeader.displayName = "UploadsPanel.Header";

/** Props for `UploadsPanel.List` — the scrollable list of file rows. */
export interface UploadsPanelListProps {
  className?: string;
  /** Compose your own rows; when omitted, one `UploadsPanel.Item` per upload. */
  children?: React.ReactNode;
}

/**
 * The scrollable file list. Renders one `UploadsPanel.Item` per upload plus the
 * "Upload more" `UploadsPanel.Action` when `onAttach` is set.
 */
function UploadsPanelList(
  { className, children }: UploadsPanelListProps,
): React.JSX.Element {
  const { uploads, onAttach } = useUploadsPanel();
  return (
    <div className={cn("max-w-2xl mx-auto space-y-1.5", className)}>
      {children ?? (
        <>
          {uploads.map((doc) => <UploadsPanelItem key={doc.id} file={doc} />)}
          {onAttach && (
            <UploadsPanelAction variant="more">
              Upload more files
            </UploadsPanelAction>
          )}
        </>
      )}
    </div>
  );
}
UploadsPanelList.displayName = "UploadsPanel.List";

/** Props accepted by an individual `UploadsPanel.Item` (file row). */
export interface UploadsPanelItemProps {
  file: UploadedFile;
  className?: string;
}

/** A single uploaded-file row: icon, name (linked when a url is present), size. */
function UploadsPanelItem(
  { file: doc, className }: UploadsPanelItemProps,
): React.JSX.Element {
  const { onRemoveUpload } = useUploadsPanel();
  return (
    <div
      className={cn(
        "group flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-2.5 transition-colors hover:bg-[var(--secondary)]",
        className,
      )}
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--secondary)] text-[var(--faint)]">
        <FileTextIcon className="size-4" />
      </div>
      <div className="flex-1 min-w-0">
        {doc.url
          ? (
            <a
              href={doc.url}
              target="_blank"
              rel="noreferrer"
              className="block truncate text-sm text-[var(--foreground)] hover:underline"
            >
              {doc.name}
            </a>
          )
          : (
            <p className="truncate text-sm text-[var(--foreground)]">
              {doc.name}
            </p>
          )}
        {doc.size != null && (
          <p className="text-xs text-[var(--faint)]">
            {formatFileSize(doc.size)}
          </p>
        )}
      </div>
      {onRemoveUpload && (
        <button
          type="button"
          onClick={() => onRemoveUpload(doc.id)}
          className="shrink-0 rounded-[var(--radius-md)] p-1.5 text-[var(--faint)] opacity-0 transition-colors hover:bg-[var(--destructive)]/10 hover:text-[var(--destructive)] group-hover:opacity-100"
          aria-label={`Remove ${doc.name}`}
        >
          <TrashIcon className="size-4" />
        </button>
      )}
    </div>
  );
}
UploadsPanelItem.displayName = "UploadsPanel.Item";

/** Props for `UploadsPanel.Empty` — the no-files state. */
export interface UploadsPanelEmptyProps {
  className?: string;
  /** Compose your own empty state; when omitted, the default copy + action. */
  children?: React.ReactNode;
}

/** The empty state: heading, hint, and the upload `UploadsPanel.Action`. */
function UploadsPanelEmpty(
  { className, children }: UploadsPanelEmptyProps,
): React.JSX.Element {
  const { onAttach } = useUploadsPanel();
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center h-full text-center",
        className,
      )}
    >
      {children ?? (
        <>
          <h1 className="text-base font-medium text-[var(--foreground)]">
            No files uploaded
          </h1>
          <p className="mt-1 max-w-sm text-sm leading-6 text-[var(--faint)]">
            Upload files to start asking questions
          </p>
          {onAttach && (
            <UploadsPanelAction variant="empty">
              Upload files
            </UploadsPanelAction>
          )}
        </>
      )}
    </div>
  );
}
UploadsPanelEmpty.displayName = "UploadsPanel.Empty";

/** Props for `UploadsPanel.Action` — the upload/attach button. */
export interface UploadsPanelActionProps {
  /**
   * Presentation only: `empty` is the pill button in the empty state, `more` is
   * the full-width "add more" row. Defaults to `empty`.
   */
  variant?: "empty" | "more";
  className?: string;
  /** Button contents; defaults per `variant`. */
  children?: React.ReactNode;
  /** Called after opening the native picker. */
  onClick?: () => void;
}

/** The upload/attach button. Opens the native file picker wired in `Root`. */
function UploadsPanelAction(
  { variant = "empty", className, children, onClick }: UploadsPanelActionProps,
): React.JSX.Element {
  const { triggerAttach } = useUploadsPanel();
  const handleClick = () => {
    triggerAttach();
    onClick?.();
  };
  return variant === "more"
    ? (
      <Button
        variant="ghost"
        onClick={handleClick}
        className={cn(
          "w-full text-[var(--faint)] hover:text-[var(--foreground)]",
          className,
        )}
      >
        {children ?? "Upload more files"}
      </Button>
    )
    : (
      <Button
        variant="primary"
        onClick={handleClick}
        className={cn("mt-4 shadow-sm", className)}
      >
        {children ?? "Upload files"}
      </Button>
    );
}
UploadsPanelAction.displayName = "UploadsPanel.Action";

/**
 * UploadsPanel — render `<UploadsPanel uploads={…} />` for the default panel, or
 * compose `UploadsPanel.Root` + `List` / `Item` / `Empty` / `Action` for a
 * custom layout. Mirrors the `ToolCall` / `Sources` compounds: render it, or
 * compose it.
 */
export const UploadsPanel = Object.assign(UploadsPanelRoot, {
  Root: UploadsPanelRoot,
  Header: UploadsPanelHeader,
  List: UploadsPanelList,
  Item: UploadsPanelItem,
  Empty: UploadsPanelEmpty,
  Action: UploadsPanelAction,
});
