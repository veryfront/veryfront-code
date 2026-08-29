/** Tunable limits used while preparing chat history for model context. */
export type MessagePrepLimits = {
  charsPerToken: number;
  historicalToolOutputMaskChars: number;
  historicalToolInputMaskChars: number;
  retainedMetadataStringMaxChars: number;
  retainedMetadataArrayMaxItems: number;
  retainedMetadataObjectMaxEntries: number;
};

/** Default limits for chat history preparation. */
export const DEFAULT_MESSAGE_PREP_LIMITS: MessagePrepLimits = {
  charsPerToken: 4,
  historicalToolOutputMaskChars: 500,
  historicalToolInputMaskChars: 1_000,
  retainedMetadataStringMaxChars: 200,
  retainedMetadataArrayMaxItems: 20,
  retainedMetadataObjectMaxEntries: 20,
};

/** Field selector retained in a historical tool-input summary. */
export type HistoricalToolInputRetainedField =
  | string
  | {
    inputName: string;
    outputName?: string;
  }
  | {
    inputNames: readonly string[];
    outputName: string;
  };

/** Policy for compacting a completed historical tool-call input. */
export type HistoricalToolInputRetentionPolicy = {
  compactCompletedInput: boolean;
  compactAfterChars?: number;
  retainInputFields?: readonly HistoricalToolInputRetainedField[];
};

/** Resolves the retention policy for a completed historical tool input. */
export type HistoricalToolInputRetentionPolicyResolver = (
  toolName: string,
  input: Record<string, unknown>,
) => HistoricalToolInputRetentionPolicy | null | undefined;

/** Diagnostic emitted when a completed historical tool input is compacted. */
export type HistoricalToolInputCompactionDiagnostic = {
  source: "provider" | "ui";
  toolName: string;
  toolCallId: string;
  originalInputChars: number;
  retainedInputChars: number;
  originalInputTokens: number;
  retainedInputTokens: number;
  originalInputHash: string;
  reason: "completed_historical_tool_input";
};

/** Options for historical tool-input compaction. */
export type HistoricalToolInputRetentionOptions = {
  resolvePolicy?: HistoricalToolInputRetentionPolicyResolver;
  diagnostics?: HistoricalToolInputCompactionDiagnostic[];
  limits?: Partial<MessagePrepLimits>;
  preserveSourceMessageIds?: readonly string[];
};

/** Options accepted by prepare provider model messages from UI messages. */
export interface PrepareProviderModelMessagesFromUiMessagesOptions {
  providerOwnedToolNames?: readonly string[];
  preserveProviderOwnedToolSourceMessageIds?: readonly string[];
  historicalToolInputRetention?: HistoricalToolInputRetentionOptions;
}

/** Approximate token categories for context diagnostics. */
export type MessageTokenBreakdown = {
  totalTokens: number;
  systemTextTokens: number;
  userContentTokens: number;
  assistantContentTokens: number;
  reasoningTokens: number;
  toolCallInputTokens: number;
  toolResultOutputTokens: number;
  fileTokens: number;
  unknownTokens: number;
};
