import * as React from "react";
import { cn } from "../../theme.ts";

export interface MessageEditFormProps {
  initialContent: string;
  onSave: (content: string) => void;
  onCancel: () => void;
}

export function MessageEditForm({
  initialContent,
  onSave,
  onCancel,
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
    <div className="w-full">
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
          "w-full resize-none rounded-xl px-4 py-3 text-[15px] leading-relaxed",
          "bg-[var(--accent)]",
          "border border-[var(--border)]",
          "focus:outline-none focus-visible:border-[var(--ring)]",
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
            "px-3 py-1.5 text-xs font-medium rounded-lg transition-colors",
            "bg-[var(--primary)] text-[var(--primary-foreground)]",
            "hover:bg-[var(--primary)]/90",
            "disabled:opacity-40 disabled:cursor-not-allowed",
          )}
        >
          Save & Submit
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-xs font-medium rounded-lg text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--accent)] transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
