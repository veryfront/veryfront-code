/**
 * `useComposerValue` — builds the `ComposerContext` value from composer state
 * props. Shared by `ChatInput` (batteries) and `ChatInput.Root` (composed).
 *
 * @module react/components/chat/composition/use-composer-value
 */

import * as React from "react";
import type { ChatFilePart } from "#veryfront/agent/react";
import type { ComposerContextValue } from "../contexts/composer-context.tsx";
import type { ModelOption } from "../../model-selector.tsx";
import type { AttachmentInfo } from "../components/attachment-pill.tsx";
import { attachmentsToFileParts, hasPendingAttachments } from "../chat-attachments.ts";

/** Composer state the context is built from (shared by `ChatInput` + `ChatInput.Root`). */
export interface ComposerStateProps {
  input: string;
  onChange: (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => void;
  /**
   * Explicit submit handler. Optional when `sendMessage` is provided — the
   * composer then owns submit (fold attachments → file parts, guard in-flight
   * uploads, clear input + attachments) so a composed consumer calls nothing.
   */
  onSubmit?: (e?: React.FormEvent) => void;
  /**
   * Send a message directly. When set, the composer builds `onSubmit` itself:
   * it trims the input, waits while any upload is still in flight, folds the
   * resolved attachments into `file` parts, sends, then clears via `setInput`
   * and `onClearAttachments`. Provide this (with `setInput`) instead of wiring
   * the submit glue in userland.
   */
  sendMessage?: (message: { text: string; files?: ChatFilePart[] }) => void;
  /** Clear the input after the composer-owned submit sends. */
  setInput?: (value: string) => void;
  /** Clear pending attachments after the composer-owned submit sends. */
  onClearAttachments?: () => void;
  isLoading?: boolean;
  stop?: () => void;
  onVoice?: () => void;
  isListening?: boolean;
  transcript?: string;
  models?: ModelOption[];
  model?: string;
  onModelChange?: (model: string) => void;
  onAttach?: (files: FileList) => void;
  onSelectAttachment?: () => void;
  attachAccept?: string;
  attachments?: AttachmentInfo[];
  onRemoveAttachment?: (id: string) => void;
}

/** Build the ComposerContext value from composer state props. */
export function useComposerValue(p: ComposerStateProps): ComposerContextValue {
  const hasResolvedAttachment = p.attachments?.some((attachment) =>
    Boolean(attachment.url) &&
    attachment.state !== "uploading" &&
    attachment.state !== "processing" &&
    attachment.state !== "error"
  ) ?? false;

  // When `sendMessage` is supplied the composer owns submit: trim, wait for
  // in-flight uploads, fold resolved attachments into file parts, send, clear.
  // Otherwise fall back to the caller's explicit `onSubmit` (controlled mode).
  const { sendMessage, setInput, onClearAttachments, onSubmit } = p;
  const onSubmitEffective = React.useCallback((e?: React.FormEvent) => {
    if (!sendMessage) {
      onSubmit?.(e);
      return;
    }
    e?.preventDefault();
    if (p.isLoading) return;
    const attachments = p.attachments ?? [];
    // Sending now would carry only the resolved files and drop the in-flight one.
    if (hasPendingAttachments(attachments)) return;
    const text = p.input.trim();
    const files = attachmentsToFileParts(attachments);
    if (!text && files.length === 0) return;
    sendMessage({ text, ...(files.length > 0 ? { files } : {}) });
    setInput?.("");
    onClearAttachments?.();
  }, [sendMessage, onSubmit, setInput, onClearAttachments, p.isLoading, p.input, p.attachments]);

  return React.useMemo<ComposerContextValue>(() => ({
    input: p.input,
    setInput: p.setInput ?? (() => {}),
    onChange: p.onChange,
    attachments: p.attachments ?? [],
    onAttach: p.onAttach,
    onSelectAttachment: p.onSelectAttachment,
    onRemoveAttachment: p.onRemoveAttachment,
    attachAccept: p.attachAccept,
    onSubmit: onSubmitEffective,
    isLoading: p.isLoading ?? false,
    canSubmit: p.input.trim().length > 0 || hasResolvedAttachment,
    onStop: p.stop,
    onVoice: p.onVoice,
    isListening: p.isListening ?? false,
    transcript: p.transcript,
    model: p.model,
    models: p.models ?? [],
    onModelChange: p.onModelChange,
  }), [
    p.input,
    p.setInput,
    p.onChange,
    p.attachments,
    p.onAttach,
    p.onSelectAttachment,
    p.onRemoveAttachment,
    p.attachAccept,
    onSubmitEffective,
    p.isLoading,
    hasResolvedAttachment,
    p.stop,
    p.onVoice,
    p.isListening,
    p.transcript,
    p.model,
    p.models,
    p.onModelChange,
  ]);
}
