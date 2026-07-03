import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as chatModule from "./index.ts";
import * as chatUI from "#veryfront/react/components/chat/chat.tsx";
import * as agentCardModule from "#veryfront/react/components/chat/agent-card.tsx";
import * as errorBoundaryModule from "#veryfront/react/components/chat/error-boundary.tsx";
import * as useChatModule from "#veryfront/agent/react/use-chat/index.ts";
import * as useAgentModule from "#veryfront/agent/react/use-agent.ts";
import * as useAgentMetadataModule from "#veryfront/agent/react/use-agent-metadata.ts";
import * as useCompletionModule from "#veryfront/agent/react/use-completion.ts";
import * as useStreamingModule from "#veryfront/agent/react/use-streaming.ts";
import * as useVoiceInputModule from "#veryfront/agent/react/use-voice-input.ts";

const expectedRuntimeExports = [
  // Target component names (renamed public API; v1 aliases retained below).
  "Attachment",
  "Reasoning",
  "ToolCall",
  "useToolCall",
  "useReasoning",
  "ChatInput",
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
  "ChatComponents",
  "ChatContextProvider",
  "ChatEmpty",
  "ChatEmptyState",
  "ChatIf",
  "ChatMessageList",
  "ChatRoot",
  "ChatSidebar",
  "ChatWithSidebar",
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
  "ThreadListContextProvider",
  "ThreadsProvider",
  "ToolStatusBadge",
  "AttachmentsPanel",
  "buildChatStreamChunkMessageMetadata",
  "isLongRunningToolRunning",
  "isHeartbeatOnlyMetadataChunk",
  "getNextChatStreamWatchdogState",
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
  "localConversationStore",
  "memoryConversationStore",
  "normalizeChatMessageMetadata",
  "normalizeAgentMetadataResponse",
  "normalizeChatUiMessageChunk",
  "normalizeChatUiMessageStream",
  "useAgent",
  "useAgentMetadata",
  "useChat",
  "useChatErrorHandler",
  "useChatContext",
  "useChatContextOptional",
  "useCompletion",
  "useComposerContext",
  "useStickToBottom",
  "useComposerContextOptional",
  "useMessageContext",
  "useMessageContextOptional",
  "useStreaming",
  "useThreadListContext",
  "useThreadListContextOptional",
  "useThreads",
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
].sort();

describe("chat/index.ts exports", () => {
  it("preserves the runtime export surface for veryfront/chat", () => {
    assertEquals(Object.keys(chatModule).sort(), expectedRuntimeExports);
  });

  it("keeps core re-exports wired to their source modules", () => {
    assertEquals(chatModule.Chat, chatUI.Chat);
    assertEquals(chatModule.ChatWithSidebar, chatUI.ChatWithSidebar);
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
    assertEquals(chatModule.useCompletion, useCompletionModule.useCompletion);
    assertEquals(chatModule.useStreaming, useStreamingModule.useStreaming);
    assertEquals(chatModule.useVoiceInput, useVoiceInputModule.useVoiceInput);
    assertEquals(chatModule.AgentCard, agentCardModule.AgentCard);
    assertEquals(
      chatModule.ChatErrorBoundary,
      errorBoundaryModule.ChatErrorBoundary,
    );
  });

  it("exposes a single render-or-compose Message (no StandaloneMessage/StreamingMessage)", () => {
    // `Message` is both the default component (`<Message message={…} />`) and
    // the compound root (`<Message.Root>…`). The old `StandaloneMessage` and
    // `StreamingMessage` split is gone.
    assertEquals(chatModule.Message, chatUI.Message);
    assertEquals("StandaloneMessage" in chatModule, false);
    assertEquals("StreamingMessage" in chatModule, false);
    assertEquals(typeof (chatModule.Message as { Root?: unknown }).Root, "object");
  });

  it("does not widen the barrel with react-only non-chat exports", () => {
    // `Markdown` is intentionally part of the chat public API (message body renderer).
    assertEquals("Markdown" in chatModule, true);
    assertEquals("chatTokens" in chatModule, false);
    assertEquals("getChatTokensCSS" in chatModule, false);
    assertEquals("ColorModeProvider" in chatModule, false);
  });
});
