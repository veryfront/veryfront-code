/**
 * Chat Component - Re-export from modular implementation
 *
 * This file maintains backward compatibility by re-exporting
 * from the new modular chat/ directory.
 *
 * @module ai/react/components/chat
 */

export {
  Chat,
  ChatComponents,
  ChatFooter,
  ChatHeader,
  ChatInput,
  ChatMessages,
  type ChatProps,
  ConversationEmptyState,
  type ConversationEmptyStateProps,
  ConversationScrollButton,
  type ConversationScrollButtonProps,
  getTextContent,
  groupPartsInOrder,
  isReasoningPart,
  isToolPart,
  Loader,
  MessageActions,
  type MessageActionsProps,
  type PartGroup,
  ReasoningCard,
  Shimmer,
  Suggestion,
  type SuggestionProps,
  Suggestions,
  type SuggestionsProps,
  ToolCallCard,
  ToolStatusBadge,
} from "./chat/index.tsx";
