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
import { useClipboardFeedback } from "../../../clipboard.ts";

/** Result of {@link useClipboard}. */
export interface UseClipboardResult {
  /** True for `timeout` ms after a successful copy. */
  copied: boolean;
  /** True for `timeout` ms after every available copy mechanism fails. */
  failed: boolean;
  /** Text associated with the settled feedback state. */
  text: string | undefined;
  /** Copy `text` to the clipboard (with a `document.execCommand` fallback). */
  copy: (text: string, ownerDocument?: Document) => Promise<void>;
}

/** Copy-to-clipboard with a transient `copied` flag. */
export function useClipboard(timeout = 2000): UseClipboardResult {
  const { outcome, copy: copyWithFeedback } = useClipboardFeedback(timeout);

  const copy = React.useCallback(async (
    text: string,
    ownerDocument?: Document,
  ): Promise<void> => {
    await copyWithFeedback(text, ownerDocument);
  }, [copyWithFeedback]);

  return {
    copied: outcome?.status === "copied",
    failed: outcome?.status === "failed",
    text: outcome?.text,
    copy,
  };
}
