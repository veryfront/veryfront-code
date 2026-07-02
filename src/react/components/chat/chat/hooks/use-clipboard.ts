/**
 * useClipboard — copy text with a transient "copied" flag and a legacy fallback.
 *
 * Extracted so both the message action bar and the code-block copy button share
 * one implementation, and so the `copied` tick can be lifted into MessageContext
 * (a composed layout keeps the affordance instead of losing it on eject).
 *
 * @module react/components/chat/chat/hooks/use-clipboard
 */

import * as React from "react";

/** Result of {@link useClipboard}. */
export interface UseClipboardResult {
  /** True for `timeout` ms after a successful copy. */
  copied: boolean;
  /** Copy `text` to the clipboard (with a `document.execCommand` fallback). */
  copy: (text: string) => Promise<void>;
}

/** Copy-to-clipboard with a transient `copied` flag. */
export function useClipboard(timeout = 2000): UseClipboardResult {
  const [copied, setCopied] = React.useState(false);

  const copy = React.useCallback(async (text: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      /* expected: clipboard API unavailable in older/insecure contexts */
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    } finally {
      setCopied(true);
      setTimeout(() => setCopied(false), timeout);
    }
  }, [timeout]);

  return { copied, copy };
}
