import * as React from "react";
import { COMPONENT_ERROR } from "#veryfront/errors/error-registry.ts";
import { cn } from "../../theme.ts";
import { CheckIcon, CopyIcon, PencilIcon, RefreshCwIcon } from "../../../ui/icons/index.ts";
import { useClipboard } from "../hooks/use-clipboard.ts";

const ACTION_BUTTON =
  "inline-flex items-center justify-center size-7 rounded-full text-[var(--faint)] transition-colors hover:bg-[var(--tertiary)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--edge-medium)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]";

/** Props accepted by the context-free message action bar. */
export interface MessageActionBarProps {
  content: string;
  /** Compose the actions. The default includes every available action. */
  children?: React.ReactNode;
  className?: string;
  /** Wrap the built-in copy; call `next()` to run it (or skip it). */
  onCopy?: (event: React.MouseEvent<HTMLButtonElement>, next: () => void) => void;
  /** When provided, renders an edit button that calls this handler. */
  onEdit?: (content: string) => void;
  /** When provided, renders a regenerate button that calls this handler. */
  onRegenerate?: () => void;
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;
}

/** Props shared by the `MessageActionBar.*` action leaves. */
export interface MessageActionBarActionProps {
  /** Override the action glyph. */
  icon?: React.ReactNode;
  className?: string;
}

interface MessageActionBarContextValue {
  content: string;
  copied: boolean;
  onCopy: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onEdit?: (content: string) => void;
  onRegenerate?: () => void;
}

const MessageActionBarContext = React.createContext<MessageActionBarContextValue | null>(null);

function useMessageActionBar(): MessageActionBarContextValue {
  const context = React.useContext(MessageActionBarContext);
  if (!context) {
    throw COMPONENT_ERROR.create({
      detail: "MessageActionBar.* must be used within <MessageActionBar>",
    });
  }
  return context;
}

/** Copy action shown before the content has been copied. */
function MessageActionBarCopy({
  icon,
  className,
}: MessageActionBarActionProps): React.ReactElement | null {
  const { copied, onCopy } = useMessageActionBar();
  if (copied) return null;
  return (
    <button
      type="button"
      onClick={onCopy}
      className={cn(ACTION_BUTTON, className)}
      title="Copy to clipboard"
      aria-label="Copy to clipboard"
    >
      {icon ?? <CopyIcon className="size-3.5" />}
    </button>
  );
}
MessageActionBarCopy.displayName = "MessageActionBar.Copy";

/** Copied-state action shown briefly after a successful copy. */
function MessageActionBarCopied({
  icon,
  className,
}: MessageActionBarActionProps): React.ReactElement | null {
  const { copied, onCopy } = useMessageActionBar();
  if (!copied) return null;
  return (
    <button
      type="button"
      onClick={onCopy}
      className={cn(ACTION_BUTTON, className)}
      title="Copied!"
      aria-label="Copied!"
    >
      {icon ?? <CheckIcon className="size-3.5" />}
    </button>
  );
}
MessageActionBarCopied.displayName = "MessageActionBar.Copied";

/** Regenerate action. Renders only when `onRegenerate` is available. */
function MessageActionBarRegenerate({
  icon,
  className,
}: MessageActionBarActionProps): React.ReactElement | null {
  const { onRegenerate } = useMessageActionBar();
  if (!onRegenerate) return null;
  return (
    <button
      type="button"
      onClick={onRegenerate}
      className={cn(ACTION_BUTTON, className)}
      title="Regenerate response"
      aria-label="Regenerate response"
    >
      {icon ?? <RefreshCwIcon className="size-3.5" />}
    </button>
  );
}
MessageActionBarRegenerate.displayName = "MessageActionBar.Regenerate";

/** Edit action. Renders only when `onEdit` is available. */
function MessageActionBarEdit({
  icon,
  className,
}: MessageActionBarActionProps): React.ReactElement | null {
  const { content, onEdit } = useMessageActionBar();
  if (!onEdit) return null;
  return (
    <button
      type="button"
      onClick={() => onEdit(content)}
      className={cn(ACTION_BUTTON, className)}
      title="Edit message"
      aria-label="Edit message"
    >
      {icon ?? <PencilIcon className="size-3.5" />}
    </button>
  );
}
MessageActionBarEdit.displayName = "MessageActionBar.Edit";

/**
 * The low-level, context-free hover action bar. Inside a `Message`, prefer
 * `Message.Actions` and its context-bound action leaves.
 */
function MessageActionBarRoot({
  content,
  children,
  className,
  onCopy,
  onEdit,
  onRegenerate,
  ref,
}: MessageActionBarProps): React.ReactElement {
  const { copied, copy } = useClipboard();
  const doCopy = React.useCallback(() => void copy(content), [copy, content]);
  const handleCopy = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      if (onCopy) onCopy(event, doCopy);
      else doCopy();
    },
    [doCopy, onCopy],
  );
  const context = React.useMemo<MessageActionBarContextValue>(
    () => ({ content, copied, onCopy: handleCopy, onEdit, onRegenerate }),
    [content, copied, handleCopy, onEdit, onRegenerate],
  );

  return (
    <MessageActionBarContext.Provider value={context}>
      <div
        ref={ref}
        className={cn(
          "flex items-center gap-0.5 opacity-0 group-hover/msg:opacity-100 transition-all duration-200",
          className,
        )}
      >
        {children ?? (
          <>
            <MessageActionBarCopy />
            <MessageActionBarCopied />
            <MessageActionBarRegenerate />
            <MessageActionBarEdit />
          </>
        )}
      </div>
    </MessageActionBarContext.Provider>
  );
}
MessageActionBarRoot.displayName = "MessageActionBar";

/**
 * Context-free message actions with addressable `Copy`, `Copied`,
 * `Regenerate`, and `Edit` icon leaves.
 */
export const MessageActionBar = Object.assign(MessageActionBarRoot, {
  Root: MessageActionBarRoot,
  Copy: MessageActionBarCopy,
  Copied: MessageActionBarCopied,
  Regenerate: MessageActionBarRegenerate,
  Edit: MessageActionBarEdit,
});
