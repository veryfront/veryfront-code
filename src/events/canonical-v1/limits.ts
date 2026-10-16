// Source model-input admission allows less than 10 MiB of UTF-8 JSON. The
// canonical wrapper and discriminator add overhead outside that source record.
export const CANONICAL_V1_MAX_STRING_BYTES = 10 * 1024 * 1024;
export const CANONICAL_V1_MAX_MEMBER_BYTES = 12 * 1024 * 1024;
