/**
 * `useChatInput` — the L3 headless composer hook (RFC 2980). Reads the enclosing
 * `<ChatInput>` context and returns the composer state plus **prop-getters** you
 * spread onto your own elements to build a fully custom composer:
 *
 * ```tsx
 * const input = useChatInput();
 * <form {...input.getFormProps()}>
 *   <textarea {...input.getFieldProps()} />
 *   <button {...input.getSubmitProps()}>Send</button>
 * </form>
 * ```
 *
 * Getters follow the merge semantics: consumer handlers compose with the
 * internal ones (consumer first; `preventDefault()` cancels the internal),
 * `className` concatenates via `cx` (veryfront's clsx — consumer classes append
 * last, matching the rest of `veryfront/ui`), other props are consumer-wins.
 * `mergeProps` is exported for composing several getters onto one element.
 *
 * Additive: built over the existing composer context, so it stays in lockstep
 * with the `<ChatInput.*>` components (which use the same context). Must be used
 * within a `<ChatInput>` / `<Chat>`.
 *
 * @module react/components/chat/hooks/use-chat-input
 */
import * as React from "react";
import { cx } from "../../../ui/cva.ts";
import {
  type ChatInputContextValue,
  useChatInputContext,
} from "../contexts/composer-context.tsx";

type AnyProps = Record<string, unknown>;

/** Compose two event handlers: `consumer` first, `internal` skipped if default-prevented. */
function chain(
  consumer: unknown,
  internal: ((e: never) => void) | undefined,
): (e: { defaultPrevented?: boolean }) => void {
  return (e) => {
    if (typeof consumer === "function") (consumer as (e: unknown) => void)(e);
    if (!e?.defaultPrevented) internal?.(e as never);
  };
}

/**
 * Merge one override object onto base props: `on*` handlers compose (override
 * first, internal skipped if `defaultPrevented`), `className` concatenates via
 * `cx` (consumer appended last), everything else is override-wins. Exported for
 * composing several getters onto one element.
 */
export function mergeProps(base: AnyProps, overrides?: AnyProps): AnyProps {
  if (!overrides) return base;
  const out: AnyProps = { ...base };
  for (const key of Object.keys(overrides)) {
    const o = overrides[key];
    const b = base[key];
    if (key === "className") {
      out[key] = cx(b as string, o as string);
    } else if (/^on[A-Z]/.test(key) && typeof b === "function") {
      out[key] = chain(o, b as (e: never) => void);
    } else {
      out[key] = o;
    }
  }
  return out;
}

/** Result of {@link useChatInput}. */
export interface UseChatInputResult {
  /** Current input text. */
  input: string;
  setInput: (value: string) => void;
  /** Whether a submit would send (non-empty, no in-flight upload, not loading). */
  canSubmit: boolean;
  isLoading: boolean;
  isListening: boolean;
  attachments: ChatInputContextValue["attachments"];
  model?: string;
  models: ChatInputContextValue["models"];

  /** Props for the `<form>` (or `.Root`): wires submit. */
  getFormProps: (overrides?: AnyProps) => AnyProps;
  /** Props for the `<textarea>`/`<input>` field: value + change + Enter-to-submit. */
  getFieldProps: (overrides?: AnyProps) => AnyProps;
  /** Props for the submit `<button>`: type + disabled from `canSubmit`. */
  getSubmitProps: (overrides?: AnyProps) => AnyProps;
  /** Props for the attach `<button>`. */
  getAttachProps: (overrides?: AnyProps) => AnyProps;
  /** Props for the voice/dictation `<button>`: `data-listening` while active. */
  getVoiceProps: (overrides?: AnyProps) => AnyProps;

  /** The exact merge used by the getters, for composing several onto one node. */
  mergeProps: typeof mergeProps;
}

/** L3 headless composer hook. Must be used within a `<ChatInput>` / `<Chat>`. */
export function useChatInput(): UseChatInputResult {
  const ctx = useChatInputContext();

  const getFormProps = React.useCallback(
    (overrides?: AnyProps): AnyProps =>
      mergeProps({ onSubmit: ctx.onSubmit }, overrides),
    [ctx.onSubmit],
  );

  const getFieldProps = React.useCallback(
    (overrides?: AnyProps): AnyProps =>
      mergeProps({
        value: ctx.input,
        onChange: ctx.onChange,
        onKeyDown: (e: React.KeyboardEvent) => {
          // Enter submits (Shift+Enter newlines); guard IME composition.
          if (
            e.key === "Enter" && !e.shiftKey &&
            !(e.nativeEvent as { isComposing?: boolean }).isComposing
          ) {
            e.preventDefault();
            ctx.onSubmit();
          }
        },
      }, overrides),
    [ctx.input, ctx.onChange, ctx.onSubmit],
  );

  const getSubmitProps = React.useCallback(
    (overrides?: AnyProps): AnyProps =>
      mergeProps({
        type: "submit",
        disabled: !ctx.canSubmit,
        "data-status": ctx.isLoading ? "streaming" : "ready",
      }, overrides),
    [ctx.canSubmit, ctx.isLoading],
  );

  const getAttachProps = React.useCallback(
    (overrides?: AnyProps): AnyProps =>
      mergeProps({
        type: "button",
        onClick: () => ctx.onSelectAttachment?.(),
      }, overrides),
    [ctx.onSelectAttachment],
  );

  const getVoiceProps = React.useCallback(
    (overrides?: AnyProps): AnyProps =>
      mergeProps({
        type: "button",
        onClick: () => ctx.onVoice?.(),
        "data-listening": ctx.isListening || undefined,
      }, overrides),
    [ctx.onVoice, ctx.isListening],
  );

  return {
    input: ctx.input,
    setInput: ctx.setInput,
    canSubmit: ctx.canSubmit,
    isLoading: ctx.isLoading,
    isListening: ctx.isListening,
    attachments: ctx.attachments,
    model: ctx.model,
    models: ctx.models,
    getFormProps,
    getFieldProps,
    getSubmitProps,
    getAttachProps,
    getVoiceProps,
    mergeProps,
  };
}
