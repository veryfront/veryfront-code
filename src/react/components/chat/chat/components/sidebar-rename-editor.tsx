/**
 * Inline rename editor used by a chat sidebar row.
 *
 * @module react/components/chat/chat/components/sidebar-rename-editor
 */
import * as React from "react";
import { cn } from "../../theme.ts";

interface ChatSidebarRenameEditorProps {
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  className?: string;
  ref?: React.Ref<HTMLDivElement>;
}

/** @internal Focus-preserving editor for a conversation row title. */
export function ChatSidebarRenameEditor({
  value,
  onChange,
  onCommit,
  onCancel,
  className,
  ref,
}: ChatSidebarRenameEditorProps): React.ReactElement {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const accessibleNameRef = React.useRef(`Rename ${value}`);
  const terminalActionRef = React.useRef<"commit" | "cancel" | null>(null);

  React.useEffect(() => {
    inputRef.current?.select();
  }, []);

  function finish(action: "commit" | "cancel"): void {
    if (terminalActionRef.current !== null) return;
    terminalActionRef.current = action;
    if (action === "commit") onCommit();
    else onCancel();
  }

  return (
    <div
      ref={ref}
      className={cn(
        // Match the display row height so entering rename mode does not shift the list.
        "flex h-8 items-center gap-1 rounded-[var(--radius-sm)] bg-[var(--accent)] px-2.5",
        className,
      )}
    >
      <input
        ref={inputRef}
        aria-label={accessibleNameRef.current}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => finish("commit")}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            finish("commit");
          } else if (event.key === "Escape") {
            event.preventDefault();
            finish("cancel");
          }
        }}
        className="min-w-0 flex-1 appearance-none border-0 bg-transparent p-0 text-[13px] leading-snug outline-none"
      />
    </div>
  );
}
