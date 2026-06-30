import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import * as chatModule from "./index.ts";
import * as chatUI from "#veryfront/react/components/chat/chat.tsx";
import * as messageModule from "#veryfront/react/components/chat/message.tsx";
import * as agentCardModule from "#veryfront/react/components/chat/agent-card.tsx";
import * as errorBoundaryModule from "#veryfront/react/components/chat/error-boundary.tsx";
import * as useChatModule from "#veryfront/agent/react/use-chat/index.ts";
import * as useAgentModule from "#veryfront/agent/react/use-agent.ts";
import * as useAgentMetadataModule from "#veryfront/agent/react/use-agent-metadata.ts";
import * as useCompletionModule from "#veryfront/agent/react/use-completion.ts";
import * as useStreamingModule from "#veryfront/agent/react/use-streaming.ts";
import * as useVoiceInputModule from "#veryfront/agent/react/use-voice-input.ts";

const expectedRuntimeExports = [
  "AgentCard",
  "AttachmentPill",
  "BranchPicker",
  "Chat",
  "ChatErrorBoundary",
  "ChatComponents",
  "ChatComposer",
  "ChatContextProvider",
  "ChatEmpty",
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
  "MessageActions",
  "MessageContextProvider",
  "MessageEditForm",
  "MessageFeedback",
  "ModelAvatar",
  "ModelSelector",
  "QuickActions",
  "ReasoningCard",
  "RichCodeBlock",
  "Shimmer",
  "SkillBadge",
  "Sources",
  "StandaloneMessage",
  "StepIndicator",
  "StreamingMessage",
  "Suggestion",
  "Suggestions",
  "TabSwitcher",
  "ThreadListContextProvider",
  "ToolCallCard",
  "ToolStatusBadge",
  "UploadsPanel",
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
  "useComposerContextOptional",
  "useMessageContext",
  "useMessageContextOptional",
  "useStreaming",
  "useThreadListContext",
  "useThreadListContextOptional",
  "useThreads",
  "useVoiceInput",
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
    assertEquals(chatModule.useAgentMetadata, useAgentMetadataModule.useAgentMetadata);
    assertEquals(
      chatModule.getAgentPromptSuggestions,
      useAgentMetadataModule.getAgentPromptSuggestions,
    );
    assertEquals(chatModule.useCompletion, useCompletionModule.useCompletion);
    assertEquals(chatModule.useStreaming, useStreamingModule.useStreaming);
    assertEquals(chatModule.useVoiceInput, useVoiceInputModule.useVoiceInput);
    assertEquals(chatModule.AgentCard, agentCardModule.AgentCard);
    assertEquals(chatModule.ChatErrorBoundary, errorBoundaryModule.ChatErrorBoundary);
  });

  it("keeps standalone message aliases separate from the chat compound export", () => {
    assertEquals(chatModule.Message, chatUI.Message);
    assertEquals(chatModule.StandaloneMessage, messageModule.Message);
    assertEquals(chatModule.StreamingMessage, messageModule.StreamingMessage);
  });

  it("does not widen the barrel with react-only non-chat exports", () => {
    assertEquals("Markdown" in chatModule, false);
    assertEquals("chatTokens" in chatModule, false);
    assertEquals("getChatTokensCSS" in chatModule, false);
    assertEquals("ColorModeProvider" in chatModule, false);
  });
});
