import * as React from "react";
import { cn } from "../../theme.ts";

/** Props accepted by message edit form. */
export interface MessageEditFormProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "className"> {
  initialContent: string;
  onSave: (content: string) => void;
  onCancel: () => void;
  className?: string;
  /** Label for the save/submit button. Defaults to "Save & Submit". */
  saveLabel?: string;
  /** Label for the cancel button. Defaults to "Cancel". */
  cancelLabel?: string;
}

/** Render message edit form. */
export function MessageEditForm({
  initialContent,
  onSave,
  onCancel,
  className,
  saveLabel = "Save & Submit",
  cancelLabel = "Cancel",
  ...props
}: MessageEditFormProps): React.ReactElement {
  const [content, setContent] = React.useState(initialContent);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.selectionStart = el.value.length;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  const resize = React.useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      } else if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const trimmed = content.trim();
        if (trimmed) onSave(trimmed);
      }
    },
    [content, onSave, onCancel],
  );

  return (
    <div {...props} className={cn("w-full", className)}>
      <textarea
        ref={textareaRef}
        value={content}
        onChange={(e) => {
          setContent(e.target.value);
          resize();
        }}
        onKeyDown={handleKeyDown}
        rows={1}
        className={cn(
          "w-full resize-none rounded-[var(--radius-lg)] px-4 py-3 text-[15px] leading-relaxed",
          "border border-[var(--outline-border)] bg-[var(--secondary)]",
          "focus:outline-none focus-visible:border-[var(--edge-medium)]",
          "text-[var(--foreground)]",
        )}
      />
      <div className="flex items-center gap-2 mt-2">
        <button
          type="button"
          onClick={() => {
            const trimmed = content.trim();
            if (trimmed) onSave(trimmed);
          }}
          disabled={!content.trim()}
          className={cn(
            "px-3 py-1.5 text-xs font-medium rounded-full transition-all",
            "bg-[var(--primary)] text-[var(--secondary)]",
            "hover:bg-[var(--secondary)] hover:text-[var(--foreground)]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--edge-medium)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]",
            "disabled:opacity-50 disabled:pointer-events-none",
          )}
        >
          {saveLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-xs font-medium rounded-full text-[var(--faint)] hover:bg-[var(--tertiary)] hover:text-[var(--foreground)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--edge-medium)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]"
        >
          {cancelLabel}
        </button>
      </div>
    </div>
  );
}
