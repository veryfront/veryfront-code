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

/** Maximum total attempts for the idempotent tool-list request in one discovery. */
export const MAX_INTEGRATION_TOOL_LIST_ATTEMPTS = 3;

/** Base delay before a tool-list retry; the wait grows linearly per attempt. */
export const INTEGRATION_TOOL_LIST_RETRY_DELAY_MS = 100;

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

/** Maximum exact catalog tool grants admitted into one local integration source. */
export const MAX_LOCAL_INTEGRATION_TOOLS = 256;

/** Maximum canonical environment-variable name accepted from local catalog metadata. */
export const MAX_LOCAL_INTEGRATION_CREDENTIAL_NAME_LENGTH = 128;

/** Maximum caller or environment credential length admitted into an HTTP header. */
export const MAX_REMOTE_INTEGRATION_API_TOKEN_LENGTH = 16_384;

/** Runtime tool names use the same ceiling as the agent invocation contract. */
export const MAX_REMOTE_INTEGRATION_TOOL_NAME_LENGTH = 128;

/** Maximum canonical connector-name length at lookup and policy boundaries. */
export const MAX_INTEGRATION_NAME_LENGTH = MAX_REMOTE_INTEGRATION_TOOL_NAME_LENGTH - 3;

/** Maximum integrations admitted into one exact-source narrowing policy. */
export const MAX_SOURCE_INTEGRATION_POLICY_INTEGRATIONS = 512;

/** A segment must leave room for the separator and the other non-empty segment. */
export const MAX_SOURCE_INTEGRATION_POLICY_SEGMENT_LENGTH = MAX_INTEGRATION_NAME_LENGTH;

/** A policy cannot usefully name more tools than remote discovery can admit. */
export const MAX_SOURCE_INTEGRATION_POLICY_TOOL_IDS = MAX_REMOTE_INTEGRATION_TOOL_DEFINITIONS;

/** Runtime tool descriptions use the same ceiling as the agent invocation contract. */
export const MAX_REMOTE_INTEGRATION_TOOL_DESCRIPTION_LENGTH = 1_024;

/** Run and agent identifiers use the same ceiling as the agent invocation contract. */
export const MAX_REMOTE_INTEGRATION_CONTEXT_ID_LENGTH = 128;

/** Runtime tool schemas use the same serialized ceiling as the agent invocation contract. */
export const MAX_REMOTE_INTEGRATION_TOOL_SCHEMA_BYTES = 16_384;

/** Prevent recursively consumed provider schemas from approaching stack limits. */
export const MAX_REMOTE_INTEGRATION_TOOL_SCHEMA_DEPTH = 64;

/**
 * Maximum server-resolved integration tool names carried in one run grant.
 *
 * The grant travels as a claim on the run-event writer token, so this bound is
 * what keeps the request header inside the few-kilobyte budget that ingress
 * proxies enforce. It mirrors the control plane's own cap.
 */
export const MAX_GRANTED_INTEGRATION_TOOL_NAMES = 100;
