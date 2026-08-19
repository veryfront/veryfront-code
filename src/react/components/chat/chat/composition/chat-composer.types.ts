/** Public type surface for the ChatInput composer. @module react/components/chat/chat/composition/chat-composer.types */

import type * as React from "react";
import type { ModelOption } from "../../model-selector.tsx";
import type { ChatTheme } from "../../theme.ts";
import type { AttachmentInfo } from "../components/attachment-pill.tsx";
import type { PolymorphicButtonAttributes } from "../../../ui/slot.tsx";
import type { ChatMessage } from "#veryfront/agent/react";
import type { ComposerStateProps } from "./use-composer-value.ts";

/** Wrap-signature onClick shared by the interactive `ChatInput` sub-parts. */
export type WrapClick<T extends HTMLElement = HTMLElement> = (
  event: React.MouseEvent<T>,
  next: () => void,
) => void;

/** Props accepted by `<ChatInput.Field>`. */
export interface ChatInputFieldProps extends
  Omit<
    React.TextareaHTMLAttributes<HTMLTextAreaElement>,
    "value" | "onChange" | "onSubmit"
  > {
  placeholder?: string;
  /** React 19: ref is a regular prop (threaded to the underlying editor). */
  ref?: React.Ref<HTMLTextAreaElement>;
}

/**
 * Backward-compatible props shared by every ChatInput action leaf.
 *
 * Keep this as a broad interface so existing wrapper interfaces, conditional
 * `asChild` values, and button-shaped prop spreads remain source-compatible.
 * The component overloads add precise element refs for literal slotted calls.
 */
export interface ChatInputActionProps extends
  Omit<
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    "children" | "onClick" | "ref" | "type"
  > {
  /** Replace the default glyph. The canonical path (RFC 2980: a leaf renders its
   * default icon when childless; pass children to replace it). */
  children?: React.ReactNode;
  icon?: React.ReactNode;
  /** Additional classes merged with the action's Button variant classes. */
  className?: string;
  onClick?: WrapClick;
  /** Merge action behavior and styling onto one custom child element. */
  asChild?: boolean;
  /** React 19: ref targets the historical native-button contract. */
  ref?: React.Ref<HTMLButtonElement>;
}

/** Literal slotted action contract with an element-specific ref and event. */
export type ChatInputSlottedActionProps<T extends HTMLElement = HTMLElement> =
  & Omit<
    PolymorphicButtonAttributes<T>,
    "children" | "onClick" | "ref" | "type"
  >
  & {
    /**
     * Merge action behavior and styling onto one custom child element. An opaque
     * component that renders a button must set its own `type="button"`.
     */
    asChild: true;
    children: React.ReactElement;
    disabled?: boolean;
    icon?: React.ReactNode;
    className?: string;
    onClick?: WrapClick<T>;
    /** React 19: ref targets the element rendered by the custom child. */
    ref?: React.Ref<T>;
  };

/** Props accepted by `<ChatInput.Send>`. */
export type ChatInputSendProps = ChatInputActionProps;

/** Props accepted by `<ChatInput.Stop>`. */
export type ChatInputStopProps = ChatInputActionProps;

/** Props accepted by `<ChatInput.Voice>`. */
export type ChatInputVoiceProps = ChatInputActionProps;

/** Props for the unified {@link ChatInputSubmit} control. */
export interface ChatInputSubmitProps extends ChatInputActionProps {
  /** Replace the idle/send glyph. With `asChild`, supplies the element in both states. */
  children?: React.ReactNode;
  /**
   * Icon shown while streaming. Defaults to the stop glyph. The `icon` prop
   * applies to the idle/send state.
   */
  stopIcon?: React.ReactNode;
}

/** Literal slotted props for the unified {@link ChatInputSubmit} control. */
export type ChatInputSlottedSubmitProps<T extends HTMLElement = HTMLElement> =
  & ChatInputSlottedActionProps<T>
  & {
    /** Icon shown while streaming. Defaults to the stop glyph. */
    stopIcon?: React.ReactNode;
  };

/** Props accepted by `<ChatInput.Model>`. */
export interface ChatInputModelProps {
  /** Additional classes passed to the model selector. */
  className?: string;
}

/** Props accepted by `<ChatInput.Attach>`. */
export interface ChatInputAttachProps {
  /** Replace the default attachment glyph. */
  icon?: React.ReactNode;
  /** Wrap the attachment action; call `next()` to open the picker. */
  onClick?: WrapClick;
  /** React 19: ref is a regular prop (the wrapper this sub-part owns). */
  ref?: React.Ref<HTMLDivElement>;
}

/** Props accepted by `<ChatInput.Export>`. */
export interface ChatInputExportProps {
  /** Messages included in the downloaded Markdown document. */
  messages: ChatMessage[];
  /** Override the download glyph. */
  icon?: React.ReactNode;
  className?: string;
  /** Wrap the download action; call `next()` to continue. */
  onClick?: WrapClick;
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLButtonElement>;
}

/** Props accepted by `<ChatInput.Toolbar>`. */
export interface ChatInputToolbarProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
  children?: React.ReactNode;
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;
}

/**
 * Props accepted by `ChatInput`.
 *
 * Every prop is optional: omitted state falls back to the surrounding
 * `ChatContext` (`<Chat.Root chat={…}>`), so a propless `<ChatInput />` wires
 * itself to the shared session. Explicit props always win, and a standalone
 * composer outside a `<Chat.Root>` still supplies its own `input`/`onChange`.
 */
export interface ChatInputProps {
  /** Current text value of the composer input (controlled). Falls back to `ChatContext.input`. */
  input?: string;
  /** Fired as the user edits the input. Falls back to `ChatContext.setInput`. */
  onChange?: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  /**
   * Update the controlled input value for headless consumers. The preset wires
   * this automatically. Direct consumers must provide it before calling
   * `useChatInput().setInput`.
   */
  setInput?: (value: string) => void;
  /** Submit the current input (Enter or the Send button). */
  onSubmit?: (e?: React.FormEvent) => void;
  /** Whether a turn is streaming. Swaps Send for Stop and disables the field. */
  isLoading?: boolean;
  /** Placeholder text for the input field. */
  placeholder?: string;
  /** Theme overrides for the composer's input/button slots. */
  theme?: ChatTheme;

  // Stop / Voice
  /** Stop the in-flight streaming turn. The default Stop control is omitted when unavailable. */
  stop?: () => void;
  /** Toggle voice input; when set, an empty field shows the mic button. */
  onVoice?: () => void;
  /** Whether voice capture is active (drives the mic pressed state). */
  isListening?: boolean;
  /** Live speech-to-text transcript shown in the field while listening. */
  transcript?: string;

  // Model
  /** Model options for the composer's model selector. */
  models?: ModelOption[];
  /** Currently selected model id. */
  model?: string;
  /** Called when the user picks a different model. */
  onModelChange?: (model: string) => void;

  /**
   * Leading toolbar slot, rendered in the footer toolbar after the `+` (Studio
   * PromptForm's leading slot). Generic: hold an `<AgentPicker>`, a template
   * button, or anything else. This was `agentSelector`, renamed to a role-neutral slot.
   */
  toolbarStart?: React.ReactNode;

  // Attachments
  /** Handle files chosen via the composer's `+` menu. */
  onAttach?: (files: FileList) => void;
  /** Open a document picker (the "Select document" menu item). */
  onSelectAttachment?: () => void;
  /**
   * Files dropped onto the composer. Defaults to `onAttach`. Pass this only to
   * treat a drop differently from the `+` menu upload.
   */
  onDrop?: (files: FileList) => void;
  /** `accept` filter for the file input (e.g. `"image/*"`). */
  attachAccept?: string;
  /** Pending attachments rendered as pills above the field. */
  attachments?: AttachmentInfo[];
  /** Remove a pending attachment by id. */
  onRemoveAttachment?: (id: string) => void;

  // Customisation
  /** Wrap the built-in attachment `+` click; call `next()` to run it. */
  onAttachClick?: WrapClick;

  className?: string;
  /** Composer-toolbar children (custom action sub-parts). */
  children?: React.ReactNode;
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;
}

/** Props accepted by `<ChatInput.Root>`. */
export type ChatInputRootProps = ComposerStateProps & {
  className?: string;
  children: React.ReactNode;
  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;
};
