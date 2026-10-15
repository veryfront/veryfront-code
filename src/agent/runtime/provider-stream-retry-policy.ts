/**
 * Replays the runtime opens after a retryable provider stream failure that
 * produced no visible output. A first-progress deadline can therefore run once
 * per attempt before the failure reaches the caller.
 */
export const MAX_RUNTIME_PROVIDER_STREAM_RETRIES = 1;

/** Provider stream attempts a single model call can make before it fails. */
export const RUNTIME_PROVIDER_STREAM_ATTEMPTS = MAX_RUNTIME_PROVIDER_STREAM_RETRIES + 1;
