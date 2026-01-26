export const AGENT_DEFAULTS = {
  maxTokens: 4096,
  temperature: 0.7,
  maxSteps: 20,
  memoryType: "conversation",
  memoryMaxTokens: 4000,
} as const;

export const STREAMING_DEFAULTS = {
  maxBufferSize: 1024 * 1024,
  chunkSize: 16384,
} as const;

export const MEMORY_DEFAULTS = {
  bufferSize: 10,
  summaryThreshold: 20,
  redisTtl: 86400,
  redisKeyPrefix: "veryfront:agent:memory:",
} as const;

export const RATE_LIMIT_DEFAULTS = {
  requestsPerMinute: 60,
  tokensPerMinute: 100000,
  windowMs: 60000,
} as const;

export const COST_TRACKING_DEFAULTS = {
  dailyBudget: 100,
  monthlyBudget: 1000,
  warningThreshold: 0.8,
} as const;

export const RETRY_DEFAULTS = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
} as const;

export const WORKFLOW_DEFAULTS = {
  timeoutMs: 300000,
  maxParallel: 10,
  checkpointIntervalMs: 5000,
  approvalTimeoutMs: 86400000,
} as const;

export const PROVIDER_DEFAULTS = {
  models: {
    openai: "gpt-4o",
    anthropic: "claude-sonnet-4-20250514",
    google: "gemini-1.5-pro",
  },
  requestTimeoutMs: 120000,
} as const;

export const SECURITY_DEFAULTS = {
  maxInputLength: 100000,
  maxOutputLength: 100000,
  redactPii: false,
} as const;

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
