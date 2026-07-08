import * as React from "react";
import { cn } from "../../theme.ts";
import { CheckIcon, CopyIcon, PencilIcon, RefreshCwIcon } from "../../../ui/icons/index.ts";
import { useClipboard } from "../hooks/use-clipboard.ts";

const ACTION_BUTTON =
  "inline-flex items-center justify-center size-7 rounded-full text-[var(--faint)] transition-colors hover:bg-[var(--tertiary)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--edge-medium)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]";

/**
 * Icon overrides for {@link MessageActionBar}. Each defaults to the built-in
 * glyph; `copied` shows briefly after a successful copy.
 */
export interface MessageActionBarIcons {
  copy?: React.ReactNode;
  copied?: React.ReactNode;
  edit?: React.ReactNode;
  regenerate?: React.ReactNode;
}

/** Props accepted by the context-free message action bar. */
export interface MessageActionBarProps {
  content: string;
  className?: string;
  /** Override any of the action icons. */
  icons?: MessageActionBarIcons;
  /** Wrap the built-in copy; call `next()` to run it (or skip it). */
  onCopy?: (event: React.MouseEvent<HTMLButtonElement>, next: () => void) => void;
  /** When provided, renders an edit button that calls this handler. */
  onEdit?: (content: string) => void;
  /** When provided, renders a regenerate button that calls this handler. */
  onRegenerate?: () => void;
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;
}

/**
 * MessageActionBar — the low-level, context-free hover action bar (copy / edit /
 * regenerate). Used where there is no `Message.Root` context (e.g. the legacy
 * message-list row). Inside a `Message`, prefer `Message.Actions` +
 * `Message.CopyAction`/… which read from context.
 *
 * Renamed from `MessageActions` to end the collision with `Message.Actions`.
 */
export function MessageActionBar(
  { content, className, icons, onCopy, onEdit, onRegenerate, ref }: MessageActionBarProps,
): React.ReactElement {
  const { copied, copy } = useClipboard();
  const doCopy = React.useCallback(() => void copy(content), [copy, content]);

  return (
    <div
      ref={ref}
      className={cn(
        // No vertical margin here — the footer row owns spacing/alignment so
        // the buttons stay centered with the token count beside them.
        "flex items-center gap-0.5 opacity-0 group-hover/msg:opacity-100 transition-all duration-200",
        className,
      )}
    >
      <button
        type="button"
        onClick={(e) => (onCopy ? onCopy(e, doCopy) : doCopy())}
        className={ACTION_BUTTON}
        title={copied ? "Copied!" : "Copy to clipboard"}
        aria-label={copied ? "Copied!" : "Copy to clipboard"}
      >
        {copied
          ? (icons?.copied ?? <CheckIcon className="size-3.5" />)
          : (icons?.copy ?? <CopyIcon className="size-3.5" />)}
      </button>
      {onRegenerate && (
        <button
          type="button"
          onClick={onRegenerate}
          className={ACTION_BUTTON}
          title="Regenerate response"
          aria-label="Regenerate response"
        >
          {icons?.regenerate ?? <RefreshCwIcon className="size-3.5" />}
        </button>
      )}
      {onEdit && (
        <button
          type="button"
          onClick={() => onEdit(content)}
          className={ACTION_BUTTON}
          title="Edit message"
          aria-label="Edit message"
        >
          {icons?.edit ?? <PencilIcon className="size-3.5" />}
        </button>
      )}
    </div>
  );
}
MessageActionBar.displayName = "MessageActionBar";
