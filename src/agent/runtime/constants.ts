/**
 * Agent Runtime Constants
 *
 * Default values and limits for agent execution.
 *
 * @module ai/agent/runtime/constants
 */

import { AGENT_DEFAULTS, STREAMING_DEFAULTS } from "../../core/ai-defaults.ts";

/** Default maximum tokens for completion */
export const DEFAULT_MAX_TOKENS = AGENT_DEFAULTS.maxTokens;

/** Default temperature for completion */
export const DEFAULT_TEMPERATURE = AGENT_DEFAULTS.temperature;

/** Maximum size for stream buffer before truncation */
export const MAX_STREAM_BUFFER_SIZE = STREAMING_DEFAULTS.maxBufferSize;

/** Default max agent steps if not configured */
export const DEFAULT_MAX_STEPS = 20;
