/**
 * ChatComposer — Input area with attachments, model selector, voice, and submit.
 *
 * @module react/components/chat/composition/chat-composer
 */

import * as React from "react";
import { InputBox } from "#veryfront/react/primitives/index.ts";
import { cn } from "../../theme.ts";
import {
  ArrowUpIcon,
  FileTextIcon,
  PaperclipIcon,
  PlusIcon,
  StopIcon,
} from "../../icons/index.ts";
import { Button } from "../../ui/button.tsx";
import { IconButton } from "../../ui/icon-button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu.tsx";
import { type ModelOption, ModelSelector } from "../../model-selector.tsx";
import type { ChatTheme } from "../../theme.ts";
import { AttachmentPill } from "../components/attachment-pill.tsx";
import type { AttachmentInfo } from "../components/attachment-pill.tsx";
import { downloadMarkdown } from "../utils/export.ts";
import type { ChatMessage } from "#veryfront/agent/react";

/** Props accepted by chat composer. */
export interface ChatComposerProps {
  input: string;
  onChange: (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => void;
  onSubmit?: (e?: React.FormEvent) => void;
  isLoading?: boolean;
  placeholder?: string;
  theme?: ChatTheme;

  // Stop / Voice
  stop?: () => void;
  onVoice?: () => void;
  isListening?: boolean;
  transcript?: string;

  // Model
  models?: ModelOption[];
  model?: string;
  onModelChange?: (model: string) => void;

  // Agent selector — rendered in the footer toolbar between the `+` and left
  // actions (Studio PromptForm `agentSelector` slot). Pass an `<AgentPicker>`.
  agentSelector?: React.ReactNode;

  // Attachments
  onAttach?: (files: FileList) => void;
  onSelectAttachment?: () => void;
  attachAccept?: string;
  attachments?: AttachmentInfo[];
  onRemoveAttachment?: (id: string) => void;

  // Export
  showExport?: boolean;
  messages?: ChatMessage[];

  className?: string;
  children?: React.ReactNode;
}

/** Render chat composer. */
export const ChatComposer = React.forwardRef<HTMLDivElement, ChatComposerProps>(
  function ChatComposer(
    {
      input,
      onChange,
      onSubmit,
      isLoading,
      placeholder = "Type a message...",
      theme,
      stop,
      isListening = false,
      transcript,
      models,
      model,
      onModelChange,
      agentSelector,
      onAttach,
      onSelectAttachment,
      attachAccept,
      attachments,
      onRemoveAttachment,
      showExport = false,
      messages,
      className,
      children,
    },
    ref,
  ) {
    const fileInputRef = React.useRef<HTMLInputElement>(null!);
    const [attachmentMenuOpen, setAttachmentMenuOpen] = React.useState(false);
    const inputPlaceholder = isListening ? "Listening..." : placeholder;
    const inputLabel = inputPlaceholder || "Message";

    return (
      <div
        ref={ref}
        className={cn("flex-shrink-0 pb-6 pt-2", className)}
      >
        <div className="mx-auto w-full max-w-3xl px-4">
          {children && (
            <div className="flex flex-wrap items-center gap-1.5 pb-3">
              {children}
            </div>
          )}
          {attachments && attachments.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pb-4">
              {attachments.map((file) => (
                <AttachmentPill
                  key={file.id}
                  attachment={file}
                  onRemove={onRemoveAttachment}
                />
              ))}
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onSubmit?.(e);
            }}
          >
            <div className="relative overflow-hidden rounded-[var(--radius-lg)] border border-transparent bg-[var(--secondary)] px-3 pt-2 pb-2 shadow-sm transition-all md:px-4 md:pt-3 md:pb-3">
              {/* Editor — occupies the top of the card (Studio PromptForm) */}
              <InputBox
                value={isListening ? transcript || input : input}
                onChange={onChange}
                onSubmit={() => onSubmit?.()}
                placeholder={inputPlaceholder}
                aria-label={inputLabel}
                disabled={isLoading || isListening}
                multiline
                className={cn(
                  "min-h-9 w-full min-w-0 py-1.5 text-base leading-6 text-[var(--foreground)] placeholder:text-[var(--faint)]",
                  theme?.input,
                )}
              />

              {/* Footer toolbar — left: + menu + agent selector; right: model + submit */}
              <div className="mt-2.5 flex min-h-[44px] items-center justify-between gap-1.5 md:gap-2">
                <div className="flex min-w-0 items-center gap-1.5 md:gap-2">
                  {(onAttach || onSelectAttachment) && (
                    <div className="relative flex shrink-0 items-center">
                      {onAttach && (
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept={attachAccept}
                          multiple
                          aria-label="Upload file"
                          onChange={(e) => {
                            if (e.target.files?.length) {
                              onAttach(e.target.files);
                            }
                            e.target.value = "";
                          }}
                          style={{
                            position: "absolute",
                            width: 1,
                            height: 1,
                            padding: 0,
                            margin: -1,
                            overflow: "hidden",
                            clip: "rect(0,0,0,0)",
                            whiteSpace: "nowrap",
                            border: 0,
                          }}
                        />
                      )}
                      {onAttach && !onSelectAttachment
                        ? (
                          // Single action → the `+` opens the OS file dialog
                          // directly, no menu needed.
                          <Button
                            type="button"
                            variant="icon-tertiary"
                            size="icon-lg"
                            onClick={() => fileInputRef.current?.click()}
                            aria-label="Add document"
                            className="shrink-0"
                          >
                            <PlusIcon />
                          </Button>
                        )
                        : (
                          // Multiple actions → portalled DropdownMenu (escapes
                          // the composer's overflow so it never clips) with icons.
                          <DropdownMenu
                            open={attachmentMenuOpen}
                            onOpenChange={setAttachmentMenuOpen}
                          >
                            <DropdownMenuTrigger asChild>
                              <Button
                                type="button"
                                variant="icon-tertiary"
                                size="icon-lg"
                                aria-label="Add document"
                                className="shrink-0"
                              >
                                <PlusIcon />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                              {onAttach && (
                                <DropdownMenuItem
                                  onSelect={() => fileInputRef.current?.click()}
                                >
                                  <PaperclipIcon />
                                  Upload document
                                </DropdownMenuItem>
                              )}
                              {onSelectAttachment && (
                                <DropdownMenuItem onSelect={onSelectAttachment}>
                                  <FileTextIcon />
                                  Select document
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                    </div>
                  )}
                  {agentSelector}
                </div>

                <div className="flex shrink-0 items-center gap-1.5 md:gap-2">
                  {models && models.length > 0 && onModelChange && (
                    <ModelSelector
                      variant="icon"
                      models={models}
                      value={model}
                      onChange={onModelChange}
                      disabled={isLoading}
                    />
                  )}
                  {showExport && messages && messages.length > 0 && (
                    <IconButton
                      type="button"
                      variant="icon-ghost"
                      size="icon-lg"
                      on="card"
                      onClick={() => downloadMarkdown(messages)}
                      aria-label="Export conversation"
                      tooltip="Export as Markdown"
                      tooltipSide="top"
                      className="shrink-0"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                    </IconButton>
                  )}
                  {isLoading
                    ? (
                      <Button
                        type="button"
                        variant="icon-ghost"
                        size="icon-lg"
                        aria-label="Stop"
                        onClick={() => stop?.()}
                        className="shrink-0"
                      >
                        <StopIcon />
                      </Button>
                    )
                    : (
                      <Button
                        type="button"
                        variant="icon-primary"
                        on="card"
                        size="icon-lg"
                        aria-label="Send"
                        disabled={!input.trim()}
                        onClick={() => onSubmit?.()}
                        className={cn("shrink-0", theme?.button)}
                      >
                        <ArrowUpIcon />
                      </Button>
                    )}
                </div>
              </div>
            </div>
          </form>
        </div>
      </div>
    );
  },
);
ChatComposer.displayName = "ChatComposer";
