import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as chatModule from "./index.ts";
import * as chatUI from "#veryfront/react/components/chat/chat.tsx";
import * as componentsChatModule from "veryfront/components/chat";
import * as reactComponentsChatModule from "veryfront/react/components/chat";
import type {
  UseConversationChatOptions as ComponentsChatOptions,
  UseConversationChatResult as ComponentsChatResult,
} from "veryfront/components/chat";
import type { ConversationStorageLimits } from "./index.ts";
import type {
  UseConversationChatOptions as ReactComponentsChatOptions,
  UseConversationChatResult as ReactComponentsChatResult,
} from "veryfront/react/components/chat";
import * as agentCardModule from "#veryfront/react/components/chat/agent-card.tsx";
import * as errorBoundaryModule from "#veryfront/react/components/chat/error-boundary.tsx";
import * as useChatModule from "#veryfront/agent/react/use-chat/index.ts";
import * as useAgentModule from "#veryfront/agent/react/use-agent.ts";
import * as useAgentMetadataModule from "#veryfront/agent/react/use-agent-metadata.ts";
import * as useCompletionModule from "#veryfront/agent/react/use-completion.ts";
import * as useStreamingModule from "#veryfront/agent/react/use-streaming.ts";
import * as useVoiceInputModule from "#veryfront/agent/react/use-voice-input.ts";

const _componentsChatOptions: ComponentsChatOptions = {};
const _reactComponentsChatOptions: ReactComponentsChatOptions = _componentsChatOptions;
const _componentsChatResult = null as unknown as ComponentsChatResult;
const _reactComponentsChatResult: ReactComponentsChatResult = _componentsChatResult;
const _storageLimits: ConversationStorageLimits = chatModule.CONVERSATION_STORAGE_LIMITS;
void _reactComponentsChatOptions;
void _reactComponentsChatResult;
void _storageLimits;

const expectedRuntimeExports = [
  // Canonical component names.
  "AttachmentPill",
  "Reasoning",
  "ToolCall",
  "useToolCall",
  "useReasoning",
  "ChatInput",
  "ChatInputAttach",
  "ChatInputExport",
  "ChatInputField",
  "ChatInputModel",
  "ChatInputRoot",
  "ChatInputSend",
  "ChatInputStop",
  "ChatInputSubmit",
  "ChatInputToolbar",
  "ChatInputVoice",
  "AgentAvatar",
  "AgentPicker",
  "ChatActions",
  "ChatAgentPicker",
  "ChatMessagesSkeleton",
  "agentsToPickerOptions",
  "normalizeAgentMetadata",
  "normalizeAgentsListResponse",
  "useAgents",
  "CodeBlock",
  "CodeSurface",
  "CopyButton",
  "useClipboard",
  "Markdown",
  "AppShell",
  "useAppShell",
  "Tabs",
  "TabsItem",
  "ChatThemeScope",
  "AgentCard",
  "BranchPicker",
  "Chat",
  "ChatErrorBoundary",
  "ChatContextProvider",
  "ChatEmpty",
  "ChatEmptyState",
  "ChatIf",
  "ChatMessageList",
  "ChatRoot",
  "ChatSidebar",
  "DEFAULT_CHAT_STREAM_TOOL_RUNNING_TIMEOUT_MS",
  "DEFAULT_CHAT_STREAM_IDLE_TIMEOUT_MS",
  "ChatStreamIdleTimeoutError",
  "ComposerContextProvider",
  "ConversationEmptyState",
  "ConversationScrollButton",
  "DropZoneOverlay",
  "ErrorBanner",
  "FadeIn",
  "InferenceBadge",
  "InlineCitation",
  "Loader",
  "Message",
  "MessageActionBar",
  "MessageContextProvider",
  "MessageEditForm",
  "MessageFeedback",
  "ModelAvatar",
  "ModelSelector",
  "QuickActions",
  "RichCodeBlock",
  "Shimmer",
  "SkillBadge",
  "SourcePill",
  "Sources",
  "useSources",
  "StepIndicator",
  "Suggestion",
  "Suggestions",
  "TabSwitcher",
  "ToolStatusBadge",
  "AttachmentsPanel",
  "buildChatStreamChunkMessageMetadata",
  "isLongRunningToolRunning",
  "isHeartbeatOnlyMetadataChunk",
  "getNextChatStreamWatchdogState",
  "getAgentPromptSuggestionItems",
  "getAgentPromptSuggestions",
  "createChatStreamWatchdogState",
  "createChatStreamWatchdog",
  "dedupeChatUiMessageChunks",
  "downloadMarkdown",
  "exportAsMarkdown",
  "extractChatMessageMetadata",
  "mapHostedStreamPartToChatUiChunks",
  "extractSourcesFromParts",
  "getTextContent",
  "groupPartsInOrder",
  "isReasoningPart",
  "isSkillToolPart",
  "isToolPart",
  "CONVERSATION_STORAGE_LIMITS",
  "ConversationStoreError",
  "localConversationStore",
  "memoryConversationStore",
  "normalizeChatMessageMetadata",
  "normalizeAgentMetadataResponse",
  "normalizeChatUiMessageChunk",
  "normalizeChatUiMessageStream",
  "useAgent",
  "useAgentMetadata",
  "useChat",
  "useConversation",
  "useConversationChat",
  "useConversations",
  "useConversationsContext",
  "useConversationsContextOptional",
  "ConversationsProvider",
  "ConversationsContextProvider",
  "useChatErrorHandler",
  "useChatContext",
  "useChatContextOptional",
  "useCompletion",
  "useComposerContext",
  "useStickToBottom",
  "useComposerContextOptional",
  "useMessageContext",
  "useMessageContextOptional",
  "useMessageParts",
  "useStreaming",
  "useAttachments",
  "useUpload",
  "useUploadsRegistry",
  "useVoiceInput",
  // Compound sub-part hooks (each throws outside its provider).
  "useAgentCard",
  "useAgentPicker",
  "useAttachmentPill",
  "useChatActions",
  "useModelSelector",
  "useStepIndicator",
  "useAttachmentsPanel",
  // RFC 2980 canonical hook + context surface (additive).
  "ChatInputContextProvider",
  "mergeProps",
  "useChatInput",
  "useChatInputContext",
  "useChatInputContextOptional",
  "useChatScroll",
  "useChatSidebarItem",
  "useMessageBranches",
].sort();

describe("chat/index.ts exports", () => {
  it("exports the canonical runtime surface for veryfront/chat", () => {
    assertEquals(Object.keys(chatModule).sort(), expectedRuntimeExports);
  });

  it("keeps core re-exports wired to their source modules", () => {
    assertEquals(chatModule.Chat, chatUI.Chat);
    assertEquals(chatModule.useChat, useChatModule.useChat);
    assertEquals(chatModule.useAgent, useAgentModule.useAgent);
    assertEquals(
      chatModule.useAgentMetadata,
      useAgentMetadataModule.useAgentMetadata,
    );
    assertEquals(
      chatModule.getAgentPromptSuggestions,
      useAgentMetadataModule.getAgentPromptSuggestions,
    );
    assertEquals(
      chatModule.getAgentPromptSuggestionItems,
      useAgentMetadataModule.getAgentPromptSuggestionItems,
    );
    assertEquals(chatModule.useCompletion, useCompletionModule.useCompletion);
    assertEquals(chatModule.useStreaming, useStreamingModule.useStreaming);
    assertEquals(chatModule.useVoiceInput, useVoiceInputModule.useVoiceInput);
    assertEquals(chatModule.AgentCard, agentCardModule.AgentCard);
    assertEquals(
      chatModule.CONVERSATION_STORAGE_LIMITS,
      chatUI.CONVERSATION_STORAGE_LIMITS,
    );
    assertEquals(chatModule.ConversationStoreError, chatUI.ConversationStoreError);
    assertEquals(
      chatModule.ChatErrorBoundary,
      errorBoundaryModule.ChatErrorBoundary,
    );
  });

  it("exports each ChatInput leaf as the same function through every chat barrel", () => {
    const parts = [
      ["ChatInputRoot", "Root"],
      ["ChatInputField", "Field"],
      ["ChatInputSend", "Send"],
      ["ChatInputStop", "Stop"],
      ["ChatInputSubmit", "Submit"],
      ["ChatInputVoice", "Voice"],
      ["ChatInputModel", "Model"],
      ["ChatInputAttach", "Attach"],
      ["ChatInputExport", "Export"],
      ["ChatInputToolbar", "Toolbar"],
    ] as const;
    for (const [flatName, partName] of parts) {
      assertEquals(chatModule[flatName], chatModule.ChatInput[partName]);
      assertEquals(chatModule[flatName], chatUI[flatName]);
      assertEquals(chatModule[flatName], componentsChatModule[flatName]);
      assertEquals(chatModule[flatName], reactComponentsChatModule[flatName]);
    }
  });

  it("exports conversation chat and canonical hooks through both component aliases", () => {
    assertEquals(componentsChatModule.useConversationChat, chatUI.useConversationChat);
    assertEquals(reactComponentsChatModule.useConversationChat, chatUI.useConversationChat);
    for (
      const name of [
        "ChatInputContextProvider",
        "mergeProps",
        "useChatInput",
        "useChatInputContext",
        "useChatInputContextOptional",
        "useChatScroll",
        "useMessageBranches",
      ] as const
    ) {
      assertEquals(componentsChatModule[name], chatUI[name]);
      assertEquals(reactComponentsChatModule[name], chatUI[name]);
    }
  });

  it("exposes only canonical render-or-compose component names", () => {
    assertEquals(chatModule.Message, chatUI.Message);
    assertEquals(typeof (chatModule.Message as { Root?: unknown }).Root, "function");
    for (
      const removed of [
        "Attachment",
        "ChatComponents",
        "ChatComposer",
        "MessageActions",
        "ReasoningCard",
        "StandaloneMessage",
        "StreamingMessage",
        "ToolCallCard",
        "UploadsPanel",
      ]
    ) {
      assertEquals(removed in chatModule, false);
    }
    assertEquals("Composer" in chatModule.Chat, false);
  });

  it("does not widen the barrel with react-only non-chat exports", () => {
    // `Markdown` is intentionally part of the chat public API (message body renderer).
    assertEquals("Markdown" in chatModule, true);
    assertEquals("chatTokens" in chatModule, false);
    assertEquals("getChatTokensCSS" in chatModule, false);
    assertEquals("ColorModeProvider" in chatModule, false);
  });
});
