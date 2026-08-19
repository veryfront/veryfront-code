import * as React from "react";
import { useClipboardFeedback } from "../../../clipboard.ts";
import { cn } from "../../theme.ts";
import { CheckIcon, CopyIcon } from "../../../ui/icons/index.ts";

/** Props accepted by code block. */
export interface CodeBlockProps {
  language?: string;
  code: string;
  inline?: boolean;
  className?: string;
  /** React 19: ref is a regular prop. Applied to the block wrapper only. */
  ref?: React.Ref<HTMLDivElement>;
}

/**
 * Render rich code block.
 *
 * Use the shared `CodeBlock` primitive (`ui/code-block.tsx`) instead. It
 * provides the maintained copy/collapse surface and accepts
 * extension-owned syntax and diagram renderers without putting third-party
 * implementations in core. This older plain `<pre>` fork is retained only for
 * compatibility and will be removed.
 */
export function RichCodeBlock(
  { language, code, inline, className, ref }: CodeBlockProps,
): React.ReactElement {
  const { outcome, copy } = useClipboardFeedback();
  const copyStatus = outcome?.text === code ? outcome.status : undefined;
  const copied = copyStatus === "copied";
  const copyLabel = copied ? "Copied" : copyStatus === "failed" ? "Copy failed" : "Copy";

  const handleCopy = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>): void => {
      void copy(code, event.currentTarget.ownerDocument);
    },
    [code, copy],
  );

  if (inline) {
    return (
      <code
        className={cn(
          "rounded-[var(--radius-xs)] bg-[var(--accent)] px-1 py-0.5 font-mono text-sm font-medium",
          className,
        )}
      >
        {code}
      </code>
    );
  }

  return (
    <div
      ref={ref}
      className={cn(
        "my-4 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--edge)]",
        className,
      )}
    >
      <div className="flex items-center justify-between px-4 py-2 text-xs text-[var(--faint)]">
        <span className="font-mono font-medium">{language || "text"}</span>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copyLabel}
          className="inline-flex items-center gap-1.5 text-[var(--faint)] transition-colors hover:text-[var(--foreground)]"
        >
          {copied
            ? (
              <>
                <span aria-hidden="true">
                  <CheckIcon className="size-3.5" />
                </span>
                <span>Copied</span>
              </>
            )
            : (
              <>
                <span aria-hidden="true">
                  <CopyIcon className="size-3.5" />
                </span>
                <span>{copyLabel}</span>
              </>
            )}
        </button>
        <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {copied ? "Code copied" : copyStatus === "failed" ? "Unable to copy code" : ""}
        </span>
      </div>
      <pre className="overflow-auto bg-[var(--secondary)] p-4 text-sm text-[var(--foreground)] [&_.hljs]:bg-transparent [&_.hljs]:p-0">
          <code className={language ? `language-${language}` : undefined}>{code}</code>
      </pre>
    </div>
  );
}
RichCodeBlock.displayName = "RichCodeBlock";
