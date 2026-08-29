/** Tunable limits used while preparing chat history for model context. */
export type MessagePrepLimits = {
  charsPerToken: number;
  historicalToolOutputMaskChars: number;
  historicalToolInputMaskChars: number;
  retainedMetadataStringMaxChars: number;
  retainedMetadataArrayMaxItems: number;
  retainedMetadataObjectMaxEntries: number;
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
