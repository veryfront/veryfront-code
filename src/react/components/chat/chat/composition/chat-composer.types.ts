/** Public type surface for the ChatInput composer. @module react/components/chat/chat/composition/chat-composer.types */

import type * as React from "react";
import type { ModelOption } from "../../model-selector.tsx";
import type { ChatTheme } from "../../theme.ts";
import type { AttachmentInfo } from "../components/attachment-pill.tsx";
import type { ChatMessage } from "#veryfront/agent/react";
import type { ComposerStateProps } from "./use-composer-value.ts";

/** Wrap-signature onClick shared by the interactive `ChatInput` sub-parts. */
export type WrapClick = (event: React.MouseEvent<HTMLElement>, next: () => void) => void;

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

/** Props shared by every ChatInput action leaf. */
interface ChatInputActionBaseProps extends
  Omit<
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    "children" | "onClick" | "ref" | "type"
  > {
  /** Replace the default glyph. The canonical path (RFC 2980: a leaf renders its
   * default icon when childless; pass children to replace it). */
  children?: React.ReactNode;
  /** @deprecated Pass `children` instead. Kept working for backward compatibility. */
  icon?: React.ReactNode;
  /** Additional classes merged with the action's Button variant classes. */
  className?: string;
  onClick?: WrapClick;
}

/** Native-button mode for a ChatInput action leaf. */
interface ChatInputNativeActionProps extends ChatInputActionBaseProps {
  asChild?: false;
  /** React 19: ref targets the rendered button. */
  ref?: React.Ref<HTMLButtonElement>;
}

/** Slotted mode for a ChatInput action leaf. */
interface ChatInputSlottedActionProps extends ChatInputActionBaseProps {
  /**
   * Merge action behavior and styling onto one custom child element. An opaque
   * component that renders a button must set its own `type="button"`.
   */
  asChild: true;
  children: React.ReactElement;
  /** React 19: ref targets the element rendered by the custom child. */
  ref?: React.Ref<HTMLElement>;
}

/** Props shared by the ChatInput action leaves. */
export type ChatInputActionProps = ChatInputNativeActionProps | ChatInputSlottedActionProps;

/** Props accepted by `<ChatInput.Send>`. */
export type ChatInputSendProps = ChatInputActionProps;

/** Props accepted by `<ChatInput.Stop>`. */
export type ChatInputStopProps = ChatInputActionProps;

/** Props accepted by `<ChatInput.Voice>`. */
export type ChatInputVoiceProps = ChatInputActionProps;

/** Props for the unified {@link ChatInputSubmit} control. */
export type ChatInputSubmitProps = ChatInputActionProps & {
  /** Replace the idle/send glyph. With `asChild`, supplies the element in both states. */
  children?: React.ReactNode;
  /**
   * Icon shown while streaming. Defaults to the stop glyph. The `icon` prop
   * applies to the idle/send state.
   */
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

/** Props accepted by `ChatInput`. */
export interface ChatInputProps {
  /** Current text value of the composer input (controlled). */
  input: string;
  /** Fired as the user edits the input. */
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
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
