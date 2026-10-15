import { JSON_VALUE_MAX_SERIALIZED_BYTES } from "#veryfront/schemas/json-value.ts";

/** Existing non-skill control-result byte ceiling, including envelope metadata. */
export const PLATFORM_TOOL_RESULT_MAX_SERIALIZED_BYTES = JSON_VALUE_MAX_SERIALIZED_BYTES + 4_096;
