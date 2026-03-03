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
          "bg-neutral-50 dark:bg-neutral-900",
          "border border-neutral-200 dark:border-neutral-700",
          "focus:outline-none focus:border-neutral-400 dark:focus:border-neutral-500",
          "text-neutral-900 dark:text-neutral-100",
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
            "bg-neutral-900 dark:bg-white text-white dark:text-neutral-900",
            "hover:bg-neutral-700 dark:hover:bg-neutral-200",
            "disabled:opacity-40 disabled:cursor-not-allowed",
          )}
        >
          Save & Submit
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-xs font-medium rounded-lg text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
