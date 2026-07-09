import type * as React from "react";
import type {
  BranchInfo,
  ChatDynamicToolPart,
  ChatFilePart,
  ChatMessage,
  ChatToolPart,
  InferenceMode,
  UseChatResult,
} from "#veryfront/agent/react";
import type { ChatTheme } from "../theme.ts";
import type { ModelOption } from "../model-selector.tsx";
import type { Source } from "./components/sources.tsx";
import type { AttachmentInfo } from "./components/attachment-pill.tsx";
import type { FeedbackValue } from "./components/message-feedback.tsx";
import type { ChatTab } from "./components/tab-switcher.tsx";
import type { UploadedFile } from "./components/attachments-panel.tsx";
import type { QuickAction } from "./components/quick-actions.tsx";
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
  // When `messages`/`input` are omitted, `<Chat>` self-drives `useChat` +
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
   * Supersedes spreading the individual `messages`/`input`/`onChange`/… props —
   * pass the whole result object and everything wires up (input, submit,
   * attachments, model, branches).
   */
  chat?: UseChatResult;

  // The individual session props below are the legacy flat controlled API,
  // kept working for one release. Prefer `chat={useChat()}`.
  /** @deprecated Pass `chat={useChat()}` instead. */
  messages?: ChatMessage[];
  /** @deprecated Pass `chat={useChat()}` instead. */
  input?: string;
  /** @deprecated Pass `chat={useChat()}` instead. */
  onChange?: (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => void;
  /** @deprecated Pass `chat={useChat()}` instead. */
  onSubmit?: (e?: React.FormEvent) => void | Promise<void>;
  /**
   * Send a message (text + optional file parts). `<Chat>` uses this to fold
   * self-managed attachments into the submitted turn.
   * @deprecated Pass `chat={useChat()}` instead.
   */
  sendMessage?: (
    message: { text: string; files?: ChatFilePart[] },
  ) => void | Promise<void>;
  /** @deprecated Pass `chat={useChat()}` instead. */
  stop?: () => void;
  /** @deprecated Pass `chat={useChat()}` instead. */
  reload?: () => void;
  /** @deprecated Pass `chat={useChat()}` instead. */
  setInput?: (value: string) => void;
  /** @deprecated Pass `chat={useChat()}` instead. */
  isLoading?: boolean;
  /** @deprecated Pass `chat={useChat()}` instead. */
  error?: Error | null;
  placeholder?: string;
  maxHeight?: string;
  className?: string;
  theme?: Partial<ChatTheme>;
  renderMessage?: (message: ChatMessage) => React.ReactNode;
  /**
   * @deprecated Tool cards render with the built-in `ToolCall` UI. Compose
   * `<Chat.Root>` + a custom `Message` if you need bespoke tool rendering.
   */
  renderTool?: (tool: ChatToolPart | ChatDynamicToolPart) => React.ReactNode;
  /** Prompt suggestions for an empty thread. Also fillable via `agent.suggestions`. */
  suggestions?: string[];
  onSuggestionClick?: (suggestion: string) => void;
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
  showScrollButton?: boolean;
  showMessageActions?: boolean;
  /** @deprecated Provide model options via `agent={{ models }}`. */
  models?: ModelOption[];
  /** @deprecated Part of the session — pass `chat={useChat()}`. */
  model?: string;
  /**
   * The actual resolved model used for avatar display.
   * @deprecated Part of the session — pass `chat={useChat()}`.
   */
  activeModel?: string;
  /** @deprecated Part of the session — pass `chat={useChat()}`. */
  onModelChange?: (model: string) => void;
  /** @deprecated Part of the session — pass `chat={useChat()}`. */
  inferenceMode?: InferenceMode;
  /** @deprecated Sources render automatically when a message carries them. */
  showSources?: boolean;
  onSourceClick?: (source: Source, index: number) => void;
  /**
   * The composer's `+` menu and drag-to-attach are on by default — `<Chat>`
   * keeps the pending files itself unless you wire the attachment props below.
   * Set `false` to hide the attach control entirely.
   */
  enableAttachments?: boolean;
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
  /** @deprecated Export is available from the composer by default. */
  showExport?: boolean;
  onFeedback?: (messageId: string, feedback: FeedbackValue) => void;
  /** @deprecated Part of the session — pass `chat={useChat()}`. */
  editMessage?: (messageId: string, newText: string) => Promise<void>;
  /** @deprecated Part of the session — pass `chat={useChat()}`. */
  getBranches?: (messageId: string) => BranchInfo;
  /** @deprecated Part of the session — pass `chat={useChat()}`. */
  switchBranch?: (messageId: string, branchIndex: number) => void;
  /** @deprecated Reasoning steps render automatically when present. */
  showSteps?: boolean;
  showTabs?: boolean;
  activeTab?: ChatTab;
  onTabChange?: (tab: ChatTab) => void;
  uploads?: UploadedFile[];
  onRemoveUpload?: (id: string) => void;
  /** @deprecated Removed — use prompt `suggestions` instead. */
  quickActions?: QuickAction[];
  /** @deprecated Removed — use prompt `suggestions` instead. */
  onQuickAction?: (action: QuickAction) => void;
  enableVoice?: boolean;
  onVoice?: () => void;
  /** Leading composer-toolbar slot (e.g. an `<AgentPicker>`). */
  toolbarStart?: React.ReactNode;
  /** @internal Hide the built-in TabSwitcher when rendered externally */
  hideTabSwitcher?: boolean;
  children?: React.ReactNode;

  /** React 19: ref is a regular prop. */
  ref?: React.Ref<HTMLDivElement>;
}
