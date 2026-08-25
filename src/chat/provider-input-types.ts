/**
 * Provider input types.
 *
 * The message-part shapes that provider conversion accepts as input, shared by
 * tool replay reconciliation and provider conversion. Kept out of both so
 * neither has to import the other's leaf types.
 */
import type { ChatUiMessagePart, ChatUiMessageRole } from "./types.ts";
import type { MessagePart } from "./conversation.ts";

type RawToolCallMessagePart = Extract<MessagePart, { type: "tool_call" }>;
type RawToolResultMessagePart = Extract<MessagePart, { type: "tool_result" }>;

/** Stored tool-call replay part accepted by provider conversion. */
export type ChatProviderModelInputToolCallPart = RawToolCallMessagePart;

/** Stored tool-result replay part accepted by provider conversion. */
export type ChatProviderModelInputToolResultPart = RawToolResultMessagePart & {
  tool_name?: string;
};

/** Message part accepted by provider conversion. */
export type ChatProviderModelInputPart =
  | ChatUiMessagePart
  | ChatProviderModelInputToolCallPart
  | ChatProviderModelInputToolResultPart;

/** Message accepted by provider conversion. */
export interface ChatProviderModelInputMessage<TMessageMetadata = unknown> {
  id: string;
  role: ChatUiMessageRole;
  parts: ChatProviderModelInputPart[];
  metadata?: TMessageMetadata;
}
