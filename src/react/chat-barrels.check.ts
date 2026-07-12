// Compile the browser barrels used by getDefaultImportMap. The runtime mapping
// is tested separately because the repository import map reserves
// veryfront/react for the server-capable development barrel.
import {
  Reasoning as ReactReasoning,
  ToolCall as ReactToolCall,
  useReasoning as useReactReasoning,
  useToolCall as useReactToolCall,
} from "./public.ts";
import type {
  ReasoningContextValue as ReactReasoningContextValue,
  ReasoningProps as ReactReasoningProps,
  ReasoningTriggerProps as ReactReasoningTriggerProps,
  ToolCallContextValue as ReactToolCallContextValue,
  ToolCallProps as ReactToolCallProps,
  ToolCallTriggerProps as ReactToolCallTriggerProps,
} from "./public.ts";
import {
  Reasoning as ChatReasoning,
  ToolCall as ChatToolCall,
  useReasoning as useChatReasoning,
  useToolCall as useChatToolCall,
} from "./components/chat/index.ts";
import type {
  ReasoningContextValue as ChatReasoningContextValue,
  ReasoningProps as ChatReasoningProps,
  ReasoningTriggerProps as ChatReasoningTriggerProps,
  ToolCallContextValue as ChatToolCallContextValue,
  ToolCallProps as ChatToolCallProps,
  ToolCallTriggerProps as ChatToolCallTriggerProps,
} from "./components/chat/index.ts";

void [
  ReactReasoning,
  ReactToolCall,
  useReactReasoning,
  useReactToolCall,
  ChatReasoning,
  ChatToolCall,
  useChatReasoning,
  useChatToolCall,
];

export type ChatReactBarrelContracts = [
  ReactReasoningContextValue,
  ReactReasoningProps,
  ReactReasoningTriggerProps,
  ReactToolCallContextValue,
  ReactToolCallProps,
  ReactToolCallTriggerProps,
  ChatReasoningContextValue,
  ChatReasoningProps,
  ChatReasoningTriggerProps,
  ChatToolCallContextValue,
  ChatToolCallProps,
  ChatToolCallTriggerProps,
];
