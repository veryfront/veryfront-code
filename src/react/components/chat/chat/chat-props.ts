import type * as React from "react";
import type { ChatMessage, PromptSuggestion, UseChatResult } from "#veryfront/agent/react";
import type { ChatTheme } from "../theme.ts";
import type { ModelOption } from "../model-selector.tsx";
import type { Source } from "./components/sources.tsx";
import type { AttachmentInfo } from "./components/attachment-pill.tsx";
import type { FeedbackValue } from "./components/message-feedback.tsx";
import type { Conversation } from "./persistence/conversation-store.ts";

// ---------------------------------------------------------------------------
// ChatProps — Preset interface
// ---------------------------------------------------------------------------

/**
 * Agent identity + agent-driven content for `<Chat>`. Collapses the old
 * `agent` / `models` / suggestion props into one object. In app mode
 * (`agentId`) this is derived from agent metadata automatically; pass it
 * yourself to drive a controlled chat.
 */
export interface ChatAgentInfo {
  /** Assistant display name for message headers + the idle hero. */
  name?: string;
  /** Assistant avatar. */
  avatarUrl?: string;
  /** Blurb under the name in the idle hero. */
  description?: string;
  /** Prompt suggestions shown on an empty thread. */
  suggestions?: string[];
  /** Model options for the composer's model selector. */
  models?: ModelOption[];
}

/** Props accepted by chat. */
export interface ChatProps {
  // --- App mode (uncontrolled) ---------------------------------------------
  // When `chat` is omitted, `<Chat>` self-drives `useChat` +
  // `useAgentMetadata` internally, so the consumer writes just
  // `<Chat agentId="…" api="/api/ag-ui" />`. These props configure that mode
  // and are ignored in the controlled mode below.
  /** Agent id — fetches avatar/name/suggestions and scopes the request. */
  agentId?: string;
  /** AG-UI endpoint for the self-driven `useChat`. @default "/api/ag-ui" */
  api?: string;
  /** Seed messages for the self-driven thread. */
  initialMessages?: ChatMessage[];
  /** Error callback for the self-driven `useChat`. */
  onError?: (error: Error) => void;
  /**
   * Persistence sink for the live thread (app mode). Fires with the whole
   * updated `conversation` (`{ id, messages, title, updatedAt, … }`) whenever
   * the messages change — point it at your store's `save`.
   *
   * Resolved by presence: an explicit `onUpdate` wins; otherwise a surrounding
   * `ConversationsProvider`'s `save` is used; with neither, the thread is
   * ephemeral. One optional prop, three behaviours — `<Chat>` is sugar over the
   * explicit primitive.
   */
  onUpdate?: (conversation: Conversation) => void;

  // --- Controlled mode ------------------------------------------------------
  /**
   * Drive `<Chat>` from a `useChat()` session you own: `<Chat chat={useChat()}>`.
   * Pass the whole result object and everything wires up (input, submit,
   * attachments, model, branches).
   */
  chat?: UseChatResult;

  placeholder?: string;
  maxHeight?: string;
  className?: string;
  theme?: Partial<ChatTheme>;
  renderMessage?: (message: ChatMessage) => React.ReactNode;
  /**
   * Prompt suggestions for an empty thread. Also fillable via
   * `agent.suggestions`. Strings become `{ label, prompt }`; pass
   * `PromptSuggestion` objects for a short label + longer prompt.
   */
  suggestions?: Array<string | PromptSuggestion>;
  /** @deprecated Use `onSuggestionSelect` for the full suggestion object. */
  onSuggestionClick?: (prompt: string) => void;
  /** Receives the selected `{ label, prompt }` object. */
  onSuggestionSelect?: (suggestion: PromptSuggestion) => void;
  /**
   * Opt-in idle hero for an empty thread (icon + title + optional blurb, plus
   * `suggestions`). When omitted, an empty thread renders as a blank canvas +
   * composer — no "What can I help with?" placeholder. Compose `Chat.Empty`
   * directly for full control.
   */
  emptyState?: {
    icon?: React.ReactNode;
    title?: string;
    description?: string;
  };
  /**
   * The thread is still loading its initial history → render the skeleton
   * instead of the idle empty state. In app mode (`agentId`) this is derived
   * automatically while the agent metadata resolves, so the generic
   * "What can I help with?" never flashes before the agent loads. Set it
   * yourself in controlled mode.
   */
  initializing?: boolean;
  /** Override the loading skeleton (defaults to `<Chat.Skeleton />`). */
  skeleton?: React.ReactNode;
  /**
   * Agent identity + agent-driven content (name / avatar / description /
   * suggestions / models). Backs assistant message headers and the idle hero;
   * in app mode (`agentId`) it's filled from agent metadata automatically.
   */
  agent?: ChatAgentInfo;
  onSourceClick?: (source: Source, index: number) => void;
  /**
   * The composer's `+` menu and drag-to-attach are on by default — `<Chat>`
   * keeps the pending files itself unless you wire the attachment props below.
   * Compose `ChatInput` without `ChatInput.Attach` to omit attachments.
   */
  /**
   * Endpoint that pending files POST to (multipart `file`) → `{ url }`. When
   * omitted, attachments are inlined as base64 `data:` URLs (no backend
   * required); set this to store files durably (e.g. `"/api/uploads"`).
   */
  uploadApi?: string;
  onAttach?: (files: FileList) => void;
  onSelectAttachment?: () => void;
  onDrop?: (files: FileList) => void;
  attachAccept?: string;
  attachments?: AttachmentInfo[];
  onRemoveAttachment?: (id: string) => void;
  onFeedback?: (messageId: string, feedback: FeedbackValue) => void;
  /** Leading composer-toolbar slot (e.g. an `<AgentPicker>`). */
  toolbarStart?: React.ReactNode;
  children?: React.ReactNode;

  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;
}
