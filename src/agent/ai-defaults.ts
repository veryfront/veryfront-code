/**
 * AI Module Default Configuration
 *
 * Centralized defaults for all AI components.
 * Import from here instead of hardcoding values.
 */

/**
 * Agent defaults
 */
export const AGENT_DEFAULTS = {
  /** Maximum tokens for completion */
  maxTokens: 4096,

  /** Default temperature for generation */
  temperature: 0.7,

  /** Maximum agent loop steps */
  maxSteps: 20,

  /** Default memory type */
  memoryType: "conversation" as const,

  /** Default memory max tokens */
  memoryMaxTokens: 4000,
} as const;

/**
 * Streaming defaults
 */
export const STREAMING_DEFAULTS = {
  /** Maximum buffer size for streaming (1MB) */
  maxBufferSize: 1024 * 1024,

  /** Chunk size for stream processing */
  chunkSize: 16384,
} as const;

/**
 * Memory defaults
 */
export const MEMORY_DEFAULTS = {
  /** Default buffer size for buffer memory */
  bufferSize: 10,

  /** Default summary threshold for summary memory */
  summaryThreshold: 20,

  /** Default Redis TTL (24 hours) */
  redisTtl: 86400,

  /** Default Redis key prefix */
  redisKeyPrefix: "veryfront:agent:memory:",
} as const;

/**
 * Rate limiting defaults
 */
export const RATE_LIMIT_DEFAULTS = {
  /** Default requests per minute */
  requestsPerMinute: 60,

  /** Default tokens per minute */
  tokensPerMinute: 100000,

  /** Default window size in ms */
  windowMs: 60000,
} as const;

/**
 * Cost tracking defaults
 */
export const COST_TRACKING_DEFAULTS = {
  /** Default daily budget (USD) */
  dailyBudget: 100,

  /** Default monthly budget (USD) */
  monthlyBudget: 1000,

  /** Budget warning threshold (percentage) */
  warningThreshold: 0.8,
} as const;

/**
 * Retry defaults
 */
export const RETRY_DEFAULTS = {
  /** Maximum retry attempts */
  maxAttempts: 3,

  /** Initial retry delay (ms) */
  initialDelayMs: 1000,

  /** Maximum retry delay (ms) */
  maxDelayMs: 30000,

  /** Backoff multiplier */
  backoffMultiplier: 2,
} as const;

/**
 * Workflow defaults
 */
export const WORKFLOW_DEFAULTS = {
  /** Default workflow timeout (5 minutes) */
  timeoutMs: 300000,

  /** Maximum parallel executions */
  maxParallel: 10,

  /** Checkpoint interval (ms) */
  checkpointIntervalMs: 5000,

  /** Approval timeout (24 hours) */
  approvalTimeoutMs: 86400000,
} as const;

/**
 * Provider defaults
 */
export const PROVIDER_DEFAULTS = {
  /** Default model for each provider */
  models: {
    openai: "gpt-4o",
    anthropic: "claude-sonnet-4-20250514",
    google: "gemini-1.5-pro",
  },

  /** Request timeout (ms) */
  requestTimeoutMs: 120000,
} as const;

/**
 * Security defaults
 */
export const SECURITY_DEFAULTS = {
  /** Maximum input length */
  maxInputLength: 100000,

  /** Maximum output length */
  maxOutputLength: 100000,

  /** PII redaction enabled */
  redactPii: false,
} as const;

/**
 * Get all defaults as a single object
 */
export const AI_DEFAULTS = {
  agent: AGENT_DEFAULTS,
  streaming: STREAMING_DEFAULTS,
  memory: MEMORY_DEFAULTS,
  rateLimit: RATE_LIMIT_DEFAULTS,
  costTracking: COST_TRACKING_DEFAULTS,
  retry: RETRY_DEFAULTS,
  workflow: WORKFLOW_DEFAULTS,
  provider: PROVIDER_DEFAULTS,
  security: SECURITY_DEFAULTS,
} as const;
