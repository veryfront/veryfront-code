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
  ConversationEmptyState,
  ConversationScrollButton,
  getTextContent,
  groupPartsInOrder,
  isReasoningPart,
  isToolPart,
  Loader,
  MessageActions,
  ReasoningCard,
  Shimmer,
  Suggestion,
  Suggestions,
  ToolCallCard,
  ToolStatusBadge,
  type ChatProps,
  type ConversationEmptyStateProps,
  type ConversationScrollButtonProps,
  type MessageActionsProps,
  type PartGroup,
  type SuggestionProps,
  type SuggestionsProps,
} from "./chat/index.tsx";
