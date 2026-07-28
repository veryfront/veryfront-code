/**
 * Shared clipboard write and transient feedback primitives for React controls.
 *
 * @module react/components/clipboard
 */

import * as React from "react";

const DEFAULT_FEEDBACK_TIMEOUT_MS = 2000;

interface ClipboardFeedbackOutcome {
  status: "copied" | "failed";
  text: string;
}

/** State returned by {@link useClipboardFeedback}. */
export interface ClipboardFeedback {
  /** The most recent settled copy outcome, or `undefined` before/while copying. */
  outcome: ClipboardFeedbackOutcome | undefined;
  /** Copy text and update `outcome` only if this remains the latest request. */
  copy: (text: string, ownerDocument?: Document) => Promise<boolean>;
}

function restoreFocus(element: Element | null): void {
  if (!element || !("focus" in element) || typeof element.focus !== "function") return;

  try {
    element.focus({ preventScroll: true });
  } catch {
    try {
      element.focus();
    } catch {
      // Focus restoration is best-effort and must not change copy success.
    }
  }
}

function restoreSelection(
  ownerDocument: Document,
  ranges: readonly Range[],
): void {
  const selection = ownerDocument.getSelection();
  if (!selection || ranges.length === 0) return;

  try {
    selection.removeAllRanges();
    for (const range of ranges) selection.addRange(range);
  } catch {
    // The selected nodes may have been removed while the copy was in flight.
  }
}

function copyWithExecCommand(text: string, ownerDocument: Document): boolean {
  const parent = ownerDocument.body ?? ownerDocument.documentElement;
  if (!parent || typeof ownerDocument.execCommand !== "function") return false;

  const activeElement = ownerDocument.activeElement;
  const selection = ownerDocument.getSelection();
  const selectedRanges: Range[] = [];
  if (selection) {
    for (let index = 0; index < selection.rangeCount; index += 1) {
      selectedRanges.push(selection.getRangeAt(index).cloneRange());
    }
  }

  let textarea: HTMLTextAreaElement | undefined;
  try {
    textarea = ownerDocument.createElement("textarea");
    textarea.value = text;
    textarea.readOnly = true;
    textarea.tabIndex = -1;
    textarea.setAttribute("aria-hidden", "true");
    textarea.style.position = "fixed";
    textarea.style.inset = "0";
    textarea.style.width = "1px";
    textarea.style.height = "1px";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    parent.appendChild(textarea);
    textarea.focus();
    textarea.select();
    return ownerDocument.execCommand("copy") === true;
  } catch {
    return false;
  } finally {
    if (textarea?.parentNode) textarea.parentNode.removeChild(textarea);
    restoreFocus(activeElement);
    restoreSelection(ownerDocument, selectedRanges);
  }
}

function resolveClipboard(ownerDocument?: Document): Clipboard | undefined {
  try {
    if (ownerDocument) {
      return ownerDocument.defaultView?.navigator.clipboard;
    }
    return typeof navigator === "undefined" ? undefined : navigator.clipboard;
  } catch {
    return undefined;
  }
}

function resolveDocument(ownerDocument?: Document): Document | undefined {
  if (ownerDocument) return ownerDocument;
  return typeof document === "undefined" ? undefined : document;
}

type ClipboardWriteResult = "aborted" | "failed" | "written";

function writeTextWithAbort(
  clipboard: Clipboard,
  text: string,
  signal?: AbortSignal,
): Promise<ClipboardWriteResult> {
  let write: Promise<void>;
  try {
    write = Promise.resolve(clipboard.writeText(text));
  } catch {
    return Promise.resolve("failed");
  }

  if (!signal) {
    return write.then(
      (): ClipboardWriteResult => "written",
      (): ClipboardWriteResult => "failed",
    );
  }
  if (signal.aborted) {
    void write.catch(() => undefined);
    return Promise.resolve("aborted");
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: ClipboardWriteResult): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", handleAbort);
      resolve(result);
    };
    const handleAbort = (): void => finish("aborted");

    signal.addEventListener("abort", handleAbort, { once: true });
    void write.then(
      () => finish("written"),
      () => finish("failed"),
    );
  });
}

/**
 * Copy text without leaking the fallback textarea or reporting false success.
 *
 * Returns `false` when neither the asynchronous Clipboard API nor the legacy
 * `execCommand("copy")` fallback completes successfully. An aborted request
 * never starts the fallback or reports success; the Clipboard API itself does
 * not expose cancellation for a write already in progress.
 */
export async function copyTextToClipboard(
  text: string,
  ownerDocument?: Document,
  signal?: AbortSignal,
): Promise<boolean> {
  if (signal?.aborted) return false;

  const clipboard = resolveClipboard(ownerDocument);
  if (clipboard && typeof clipboard.writeText === "function") {
    const result = await writeTextWithAbort(clipboard, text, signal);
    if (result === "written") return true;
    if (result === "aborted") return false;
    // In insecure or denied contexts, try the synchronous browser fallback.
  }

  if (signal?.aborted) return false;
  const resolvedDocument = resolveDocument(ownerDocument);
  if (!resolvedDocument) return false;
  try {
    return copyWithExecCommand(text, resolvedDocument);
  } catch {
    return false;
  }
}

/**
 * Coordinate clipboard writes and a bounded success/failure feedback window.
 *
 * Later requests supersede earlier ones, and pending writes cannot update an
 * unmounted component.
 */
export function useClipboardFeedback(
  timeout = DEFAULT_FEEDBACK_TIMEOUT_MS,
): ClipboardFeedback {
  const [outcome, setOutcome] = React.useState<ClipboardFeedbackOutcome>();
  const operationRef = React.useRef(0);
  const mountedRef = React.useRef(true);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const controllerRef = React.useRef<AbortController | undefined>(undefined);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      operationRef.current += 1;
      controllerRef.current?.abort();
      clearTimeout(timerRef.current);
    };
  }, []);

  const copy = React.useCallback(
    async (text: string, ownerDocument?: Document): Promise<boolean> => {
      const operation = ++operationRef.current;
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      if (mountedRef.current) setOutcome(undefined);

      const copied = await copyTextToClipboard(text, ownerDocument, controller.signal);
      if (!mountedRef.current || operation !== operationRef.current) return copied;

      setOutcome({ status: copied ? "copied" : "failed", text });
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        if (mountedRef.current && operation === operationRef.current) {
          setOutcome(undefined);
        }
      }, timeout);
      return copied;
    },
    [timeout],
  );

  return { outcome, copy };
}
