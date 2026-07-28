/**
 * Resource limits owned by the observability boundary.
 *
 * OpenTelemetry's stable default attribute-count limit is 128. The remaining
 * limits keep core-owned snapshots and asynchronous file-log work bounded
 * before an exporter or filesystem adapter receives them.
 */
export const MAX_TELEMETRY_ATTRIBUTE_COUNT = 128;
export const MAX_TELEMETRY_ATTRIBUTE_KEY_LENGTH = 255;
export const MAX_TELEMETRY_ATTRIBUTE_ARRAY_LENGTH = 128;

export const MAX_STRUCTURED_TELEMETRY_DEPTH = 16;
export const MAX_STRUCTURED_TELEMETRY_CONTAINER_ENTRIES = 1_024;
export const MAX_STRUCTURED_TELEMETRY_NODES = 4_096;

export const MAX_FILE_LOG_PENDING_WRITES = 256;
export const MAX_FILE_LOG_RETAINED_FAILURES = 16;

export const MAX_OBSERVABILITY_CONFIG_TEXT_LENGTH = 4_096;
export const MAX_OBSERVABILITY_NAME_LENGTH = 255;
export const MAX_APPLICATION_ERROR_CONTEXT_VALUE_LENGTH = 1_000;
export const MAX_REQUEST_PROFILE_PHASES = 128;
