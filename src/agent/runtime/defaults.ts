export const AGENT_DEFAULTS = {
  maxTokens: 4_096,
  temperature: 0.7,
  maxSteps: 20,
  memoryType: "conversation",
  memoryMaxTokens: 4_000,
} as const;

export const STREAMING_DEFAULTS = {
  maxBufferSize: 1_024 * 1_024, // 1 MB
  chunkSize: 16_384,
} as const;
