export type StreamLifecyclePhase =
  | "awaiting_first_progress"
  | "streaming"
  | "awaiting_tool_input"
  | "tool_handoff"
  | "completed"
  | "failed"
  | "cancelled";

export type StreamProviderDeadlineKind =
  | "first_progress"
  | "semantic_idle"
  | "tool_input_idle"
  | "tool_commit_grace";

export type StreamCancellationSource =
  | "user"
  | "parent"
  | "runtime"
  | "client_disconnected"
  | "consumer_stopped";

export interface StreamUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  reasoningTokens?: number;
  billableInputTokens?: number;
  billableOutputTokens?: number;
  costUsd?: number;
  providerInputCostUsd?: number;
  providerOutputCostUsd?: number;
  providerCostUsd?: number;
  veryfrontInputChargeUsd?: number;
  veryfrontOutputChargeUsd?: number;
  veryfrontChargeUsd?: number;
  veryfrontBilledUsd?: number;
  costCredits?: number;
  costSource?: "gateway" | "missing" | "partial";
  billingMode?: "direct" | "deferred";
  usageCaptureStatus?: "complete" | "partial" | "missing";
}

export type StreamProtocolEvent =
  | { type: "message_start"; messageId?: string }
  | { type: "step_start" }
  | { type: "text_start"; id?: string }
  | { type: "text_content"; id?: string; delta: string }
  | { type: "text_end"; id?: string }
  | { type: "reasoning_start"; id: string }
  | { type: "reasoning_content"; id: string; delta: string }
  | {
    type: "reasoning_end";
    id: string;
    signature?: string;
    redactedData?: string;
  }
  | {
    type: "tool_input_start";
    toolCallId: string;
    toolName: string;
    providerExecuted?: boolean;
    dynamic?: boolean;
  }
  | { type: "tool_input_content"; toolCallId: string; delta: string }
  | {
    type: "tool_input_ready";
    toolCallId: string;
    toolName: string;
    input: unknown;
    providerExecuted?: boolean;
    dynamic?: boolean;
    /**
     * True when the provider delivered the complete input in one part, so a
     * live projection must not synthesize a start/delta announcement. This is
     * a compatibility presentation hint, never a semantic distinction.
     */
    announced?: boolean;
  }
  | {
    type: "tool_input_rejected";
    toolCallId: string;
    toolName: string;
    reason: "invalid" | "malformed" | "unavailable";
  }
  | {
    type: "provider_tool_start";
    toolCallId: string;
    toolName: string;
    providerExecuted: true;
  }
  | {
    type: "provider_tool_result";
    toolCallId: string;
    toolName: string;
    output: unknown;
    isError: boolean;
    providerExecuted: true;
    dynamic?: boolean;
    preliminary?: boolean;
  }
  | {
    type: "provider_tool_denied";
    toolCallId: string;
    toolName: string;
    providerExecuted: true;
  }
  | {
    type: "provider_tool_cancelled";
    toolCallId: string;
    toolName: string;
    providerExecuted: true;
  }
  | {
    type: "step_finish";
    finishReason:
      | "stop"
      | "length"
      | "tool-calls"
      | "content-filter"
      | "other"
      | null;
  }
  | { type: "custom"; name: string; data: unknown };

export type StreamSignal =
  | { kind: "protocol"; event: StreamProtocolEvent }
  | { kind: "usage"; usage: StreamUsage }
  | { kind: "provider_error"; error: StreamProviderError }
  | { kind: "diagnostic_candidate"; candidate: StreamRawDiagnosticCandidate };

export type StreamSemanticEvent =
  | StreamProtocolEvent
  | { type: "usage"; usage: StreamUsage };

export type StreamTelemetryEvent =
  | {
    type: "tool_input_status";
    toolCallId: string;
    status: "pending_input" | "streaming_input";
  }
  | { type: "live_heartbeat" }
  | { type: "child_progress"; state: string };

export type StreamDiagnosticEvent =
  | { type: "provider_part_rejected"; partType?: string }
  | { type: "protocol_repair"; code: string }
  | {
    type: "protocol_violation";
    code: "invalid_tool_transition" | "invalid_terminal_state";
  }
  | { type: "deadline"; action: "armed" | "advanced" | "fired"; code: string }
  | { type: "provider_cleanup_failed"; diagnosticId?: string }
  | { type: "provider_diagnostic"; event: StreamSafeDiagnosticEvent };

export type StreamLifecycleFrame =
  & {
    sequence: number;
    elapsedMs: number;
  }
  & (
    | { class: "semantic"; event: StreamSemanticEvent }
    | { class: "telemetry"; event: StreamTelemetryEvent }
    | { class: "diagnostic"; event: StreamDiagnosticEvent }
  );

export interface StreamToolSnapshot {
  id: string;
  name: string;
  phase:
    | "input_open"
    | "input_streaming"
    | "input_ready"
    | "input_rejected"
    | "running"
    | "succeeded"
    | "failed"
    | "denied"
    | "cancelled";
  inputText: string;
  inputDeltas: readonly string[];
  input?: unknown;
  rejectionReason?: "invalid" | "malformed" | "unavailable";
  output?: unknown;
  error?: unknown;
  preliminary?: boolean;
  providerExecuted?: boolean;
  dynamic?: boolean;
}

export interface StreamSnapshot {
  phase: StreamLifecyclePhase;
  accumulatedText: string;
  reasoning: readonly {
    id: string;
    text: string;
    signature?: string;
    redactedData?: string;
  }[];
  tools: readonly StreamToolSnapshot[];
  finishReason:
    | "stop"
    | "length"
    | "tool-calls"
    | "content-filter"
    | "other"
    | null;
  usage: StreamUsage;
  hasStreamOutput: boolean;
  hasSemanticProgress: boolean;
}

export interface StreamProviderError {
  code: string;
  publicMessage: string;
  retryable: boolean;
  terminal: boolean;
  diagnosticId?: string;
}

export interface StreamRawDiagnosticCandidate {
  kind: string;
  value: unknown;
}

export interface StreamSafeDiagnosticEvent {
  kind: string;
  attributes: Readonly<Record<string, string | number | boolean>>;
}

export interface StreamDiagnosticPolicy {
  rawCapture: "disabled" | "redacted";
  redact(
    candidate: StreamRawDiagnosticCandidate,
  ): StreamSafeDiagnosticEvent | null;
}

export interface StreamDiagnosticSink {
  report(event: StreamDiagnosticEvent): void;
}

export interface StreamCancellationInput {
  source: Exclude<StreamCancellationSource, "consumer_stopped">;
  signal: AbortSignal;
}

export interface MonotonicClock {
  nowMs(): number;
  waitUntil(
    deadlineMs: number,
    signal?: AbortSignal,
  ): Promise<"deadline" | "aborted">;
}

export interface StreamLifecyclePolicy {
  clock: MonotonicClock;
  firstProgressTimeoutMs: number;
  semanticIdleTimeoutMs: number;
  toolInputIdleTimeoutMs: number;
  toolCommitGraceMs: number;
  statusIntervalMs: number;
  attemptTimeoutMs: number;
}

export interface StreamProviderAdapter<TProviderPart> {
  open(signal: AbortSignal): AsyncIterable<TProviderPart>;
  decode(
    part: TProviderPart,
    snapshot: Readonly<StreamSnapshot>,
  ): readonly StreamSignal[];
  classifyError(
    error: unknown,
    snapshot: Readonly<StreamSnapshot>,
  ): StreamProviderError;
}

export interface StreamCommittedToolCall {
  id: string;
  name: string;
  arguments: string;
  inputDeltas: readonly string[];
  inputAnnounced: boolean;
  inputAvailable: true;
  providerExecuted?: false;
  dynamic?: boolean;
}

export interface StreamLifecycleError {
  code:
    | "FIRST_PROGRESS_TIMEOUT"
    | "SEMANTIC_IDLE_TIMEOUT"
    | "TOOL_INPUT_TIMEOUT"
    | "TOOL_INPUT_INCOMPLETE"
    | "STREAM_ATTEMPT_TIMEOUT"
    | "PROTOCOL_VIOLATION"
    | "PROVIDER_STREAM_ERROR"
    | "PROVIDER_TERMINAL_ERROR";
  phase: StreamLifecyclePhase;
  source: "provider" | "runtime" | "tool";
  retryable: boolean;
  publicMessage: string;
  providerCode?: string;
  diagnosticId?: string;
}

export interface StreamOutcomeBase {
  snapshot: StreamSnapshot;
  usage: StreamUsage;
  elapsedMs: number;
  phase: StreamLifecyclePhase;
}

export type StreamOutcome =
  | (StreamOutcomeBase & {
    status: "completed";
    finishReason: "stop" | "length" | "content-filter" | "other";
  })
  | (StreamOutcomeBase & {
    status: "tool_handoff";
    finishReason: "tool-calls";
    toolCalls: readonly StreamCommittedToolCall[];
  })
  | (StreamOutcomeBase & {
    status: "cancelled";
    source: StreamCancellationSource;
    publicMessage: string;
    diagnosticId?: string;
  })
  | (StreamOutcomeBase & {
    status: "failed";
    error: StreamLifecycleError;
  });

export interface StreamLifecycleInput<TProviderPart> {
  provider: StreamProviderAdapter<TProviderPart>;
  policy?: Partial<StreamLifecyclePolicy>;
  cancellations?: readonly StreamCancellationInput[];
  diagnostics?: StreamDiagnosticPolicy;
  diagnosticSink?: StreamDiagnosticSink;
  observer?: StreamLifecycleObserver;
}

export interface StreamLifecycleRun {
  frames: AsyncIterable<StreamLifecycleFrame>;
  outcome: Promise<StreamOutcome>;
}

/** Fail-open observer for lifecycle ownership points. */
export interface StreamLifecycleObserver {
  onFrame(frame: StreamLifecycleFrame): void;
  onSemanticProgress(input: {
    elapsedMs: number;
    sincePreviousProgressMs: number | null;
    phase: StreamLifecyclePhase;
  }): void;
  onDeadline(deadline: StreamProviderDeadlineKind | "attempt"): void;
  onOutcome(outcome: StreamOutcome): void;
}
