/**
 * Resource ceilings for the remote integration bridge.
 *
 * Keep these limits independent of agent, worker, and provider modules so the
 * integration boundary does not acquire an inverted dependency on one of its
 * consumers. The values are deliberately generous for existing integrations
 * while still placing deterministic bounds on authenticated remote input.
 */

/** End-to-end deadline for one integration API request, including body reads. */
export const INTEGRATION_REQUEST_TIMEOUT_MS = 30_000;

/** Maximum serialized request accepted by the remote tool-call endpoint. */
export const MAX_INTEGRATION_CALL_REQUEST_BYTES = 4 * 1024 * 1024;

/** Maximum decoded JSON response accepted from tool discovery. */
export const MAX_INTEGRATION_TOOL_LIST_RESPONSE_BYTES = 16 * 1024 * 1024;

/** Maximum decoded JSON response accepted from tool execution. */
export const MAX_INTEGRATION_TOOL_CALL_RESPONSE_BYTES = 4 * 1024 * 1024;

/** Maximum diagnostic prefix retained from a failed integration API response. */
export const MAX_INTEGRATION_API_ERROR_RESPONSE_BYTES = 4 * 1024;

/** Maximum number of remote tool definitions admitted atomically. */
export const MAX_REMOTE_INTEGRATION_TOOL_DEFINITIONS = 1_000;

/** Runtime tool names use the same ceiling as the agent invocation contract. */
export const MAX_REMOTE_INTEGRATION_TOOL_NAME_LENGTH = 128;

/** Runtime tool descriptions use the same ceiling as the agent invocation contract. */
export const MAX_REMOTE_INTEGRATION_TOOL_DESCRIPTION_LENGTH = 1_024;

/** Run and agent identifiers use the same ceiling as the agent invocation contract. */
export const MAX_REMOTE_INTEGRATION_CONTEXT_ID_LENGTH = 128;

/** Runtime tool schemas use the same serialized ceiling as the agent invocation contract. */
export const MAX_REMOTE_INTEGRATION_TOOL_SCHEMA_BYTES = 16_384;

/** Prevent recursively consumed provider schemas from approaching stack limits. */
export const MAX_REMOTE_INTEGRATION_TOOL_SCHEMA_DEPTH = 64;
