/**
 * `useChatInput` - the L3 headless composer hook (RFC 2980). Reads the enclosing
 * `<ChatInput>` context and returns the composer state plus **prop-getters** you
 * spread onto your own elements to build a fully custom composer:
 *
 * ```tsx
 * import { useState } from "react";
 * import { ChatInput, useChatInput } from "veryfront/chat";
 *
 * function Fields() {
 *   const input = useChatInput();
 *   return (
 *     <form {...input.getFormProps()}>
 *       <textarea {...input.getFieldProps()} />
 *       <button {...input.getSubmitProps()}>Send</button>
 *     </form>
 *   );
 * }
 *
 * export function CustomComposer({
 *   onSend,
 * }: {
 *   onSend: (message: { text: string }) => void;
 * }) {
 *   const [value, setValue] = useState("");
 *   return (
 *     <ChatInput.Root
 *       input={value}
 *       onChange={(event) => setValue(event.currentTarget.value)}
 *       sendMessage={onSend}
 *       setInput={setValue}
 *     >
 *       <Fields />
 *     </ChatInput.Root>
 *   );
 * }
 * ```
 *
 * Getters follow the merge semantics: consumer handlers compose with the
 * internal ones (consumer first; `preventDefault()` cancels the internal),
 * `className` concatenates via `cx` (veryfront's clsx; consumer classes append
 * last, matching the rest of `veryfront/ui`), other props are consumer-wins.
 * `mergeProps` is exported for composing several getters onto one element.
 *
 * Additive: built over the existing composer context, so it stays in lockstep
 * with the `<ChatInput.*>` components (which use the same context). Must be used
 * within a `<ChatInput>` / `<Chat>`.
 *
 * @module react/components/chat/chat/hooks/use-chat-input
 */
import * as React from "react";
import { handleInputBoxKeyDown } from "#veryfront/react/primitives/input-box.tsx";
import { cx } from "../../../ui/cva.ts";
import { type ChatInputContextValue, useChatInputContext } from "../contexts/composer-context.tsx";

type PropsRecord = Record<string, unknown>;
type EventHandler = (...args: unknown[]) => unknown;
type ChatInputSubmitGetterProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  "data-status"?: "streaming" | "ready";
};
type ChatInputVoiceGetterProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  "data-listening"?: true;
};

/** Compose two event handlers: `consumer` first, `internal` skipped if default-prevented. */
function chain(
  consumer: EventHandler | undefined,
  internal: EventHandler,
): EventHandler {
  return (...args) => {
    consumer?.(...args);
    const event = args[0];
    const defaultPrevented = typeof event === "object" && event !== null &&
      "defaultPrevented" in event && event.defaultPrevented === true;
    if (!defaultPrevented) internal(...args);
  };
}

/**
 * Merge one override object onto base props: `on*` handlers compose (override
 * first, internal skipped if `defaultPrevented`), `className` concatenates via
 * `cx` (consumer appended last), everything else is override-wins. Exported for
 * composing several getters onto one element.
 */
export function mergeProps<Base extends object, Overrides extends object = Partial<Base>>(
  base: Base,
  overrides?: Overrides,
): Base & Overrides {
  if (!overrides) return base as Base & Overrides;
  const baseRecord = base as PropsRecord;
  const overrideRecord = overrides as PropsRecord;
  const out: PropsRecord = { ...baseRecord };
  for (const key of Object.keys(overrideRecord)) {
    const overrideValue = overrideRecord[key];
    if (overrideValue === undefined) continue;
    const baseValue = baseRecord[key];
    if (key === "className") {
      out[key] = cx(baseValue as string | undefined, overrideValue as string | undefined);
    } else if (/^on[A-Z]/.test(key) && typeof baseValue === "function") {
      out[key] = chain(
        typeof overrideValue === "function" ? overrideValue as EventHandler : undefined,
        baseValue as EventHandler,
      );
    } else {
      out[key] = overrideValue;
    }
  }
  return out as Base & Overrides;
}

/** Result of {@link useChatInput}. */
export interface UseChatInputResult {
  /** Current input text. */
  input: string;
  /** Update the controlled input value. */
  setInput: (value: string) => void;
  /** Whether a submit would send (non-empty, no in-flight upload, not loading). */
  canSubmit: boolean;
  isLoading: boolean;
  isListening: boolean;
  /** Whether voice input is currently available; use this to omit a custom control. */
  canUseVoice: boolean;
  /** Whether an upload or document-picker action is configured. */
  canAttach: boolean;
  attachments: ChatInputContextValue["attachments"];
  model?: string;
  models: ChatInputContextValue["models"];

  /** Props for the `<form>` (or `.Root`): wires submit. */
  getFormProps: (
    overrides?: React.FormHTMLAttributes<HTMLFormElement>,
  ) => React.FormHTMLAttributes<HTMLFormElement>;
  /** Props for a `<textarea>`: live value, disabled state, change, and Enter submit. */
  getFieldProps: (
    overrides?: React.TextareaHTMLAttributes<HTMLTextAreaElement>,
  ) => React.TextareaHTMLAttributes<HTMLTextAreaElement>;
  /** Props for the submit `<button>`: type + disabled from `canSubmit`. */
  getSubmitProps: (
    overrides?: ChatInputSubmitGetterProps,
  ) => ChatInputSubmitGetterProps;
  /** Props for the attach `<button>`: opens the upload or document picker. */
  getAttachProps: (
    overrides?: React.ButtonHTMLAttributes<HTMLButtonElement>,
  ) => React.ButtonHTMLAttributes<HTMLButtonElement>;
  /** Props for the voice button: availability, pressed state, and click behavior. */
  getVoiceProps: (
    overrides?: ChatInputVoiceGetterProps,
  ) => ChatInputVoiceGetterProps;

  /** The exact merge used by the getters, for composing several onto one node. */
  mergeProps: typeof mergeProps;
}

/** L3 headless composer hook. Must be used within a `<ChatInput>` / `<Chat>`. */
export function useChatInput(): UseChatInputResult {
  const ctx = useChatInputContext();
  const canAttach = Boolean(ctx.onOpenAttachmentPicker || ctx.onSelectAttachment);

  const getFormProps = React.useCallback(
    (
      overrides?: React.FormHTMLAttributes<HTMLFormElement>,
    ): React.FormHTMLAttributes<HTMLFormElement> =>
      mergeProps<React.FormHTMLAttributes<HTMLFormElement>>({
        // Cancel the native submit before delegating, matching the <form> the
        // built-in <ChatInput> renders. A spread onto a real <form> must never
        // navigate the page.
        onSubmit: (e: React.FormEvent) => {
          e.preventDefault();
          if (ctx.canSubmit) ctx.onSubmit(e);
        },
      }, overrides),
    [ctx.canSubmit, ctx.onSubmit],
  );

  const getFieldProps = React.useCallback(
    (
      overrides?: React.TextareaHTMLAttributes<HTMLTextAreaElement>,
    ): React.TextareaHTMLAttributes<HTMLTextAreaElement> =>
      mergeProps<React.TextareaHTMLAttributes<HTMLTextAreaElement>>({
        value: ctx.isListening ? ctx.transcript || ctx.input : ctx.input,
        disabled: ctx.isLoading || ctx.isListening,
        onChange: ctx.onChange,
        // Reuse the primitive's complete IME guard (native/synthetic
        // `isComposing` plus the keyCode 229 fallback) so a custom textarea and
        // <ChatInput.Field> cannot diverge across browsers.
        onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) =>
          handleInputBoxKeyDown(e, undefined, ctx.canSubmit ? () => ctx.onSubmit() : undefined),
      }, overrides),
    [
      ctx.canSubmit,
      ctx.input,
      ctx.isListening,
      ctx.isLoading,
      ctx.onChange,
      ctx.onSubmit,
      ctx.transcript,
    ],
  );

  const getSubmitProps = React.useCallback(
    (
      overrides?: ChatInputSubmitGetterProps,
    ): ChatInputSubmitGetterProps =>
      mergeProps<ChatInputSubmitGetterProps>({
        type: "submit",
        disabled: !ctx.canSubmit,
        "data-status": ctx.isLoading ? "streaming" : "ready",
      }, overrides),
    [ctx.canSubmit, ctx.isLoading],
  );

  const getAttachProps = React.useCallback(
    (
      overrides?: React.ButtonHTMLAttributes<HTMLButtonElement>,
    ): React.ButtonHTMLAttributes<HTMLButtonElement> => {
      const merged = mergeProps<React.ButtonHTMLAttributes<HTMLButtonElement>>({
        type: "button",
        disabled: !canAttach,
        onClick: () => {
          if (!canAttach) return;
          if (ctx.onOpenAttachmentPicker) ctx.onOpenAttachmentPicker();
          else ctx.onSelectAttachment?.();
        },
      }, overrides);
      return { ...merged, disabled: !canAttach || merged.disabled };
    },
    [canAttach, ctx.onOpenAttachmentPicker, ctx.onSelectAttachment],
  );

  const canUseVoice = !ctx.isLoading && !ctx.canSubmit && Boolean(ctx.onVoice);

  const getVoiceProps = React.useCallback(
    (
      overrides?: ChatInputVoiceGetterProps,
    ): ChatInputVoiceGetterProps => {
      const merged = mergeProps<ChatInputVoiceGetterProps>({
        type: "button",
        disabled: !canUseVoice,
        onClick: () => {
          if (canUseVoice) ctx.onVoice?.();
        },
        "aria-pressed": ctx.isListening,
        "data-listening": ctx.isListening || undefined,
      }, overrides);
      // Availability is a safety invariant, not a consumer styling choice.
      // Preserve an explicit consumer disable while preventing unavailable
      // voice input from being re-enabled through an override.
      return { ...merged, disabled: !canUseVoice || merged.disabled };
    },
    [canUseVoice, ctx.onVoice, ctx.isListening],
  );

  return {
    input: ctx.input,
    setInput: ctx.setInput,
    canSubmit: ctx.canSubmit,
    canAttach,
    isLoading: ctx.isLoading,
    isListening: ctx.isListening,
    canUseVoice,
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
