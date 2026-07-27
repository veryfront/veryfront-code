/**
 * Internal resource and boundary limits for the skill subsystem.
 *
 * Keep shared limits here so schemas, direct APIs, discovery, and execution
 * cannot drift into enforcing different budgets.
 */

export const SKILL_ID_MAX_LENGTH = 256;
export const SKILL_ROOT_PATH_MAX_LENGTH = 4_096;
export const SKILL_RELATIVE_PATH_MAX_LENGTH = 1_024;
export const SKILL_DOCUMENT_MAX_CHARACTERS = 1_048_576;
export const SKILL_TEXT_FILE_MAX_BYTES = 1_048_576;

export const SKILL_ALLOWED_TOOL_MAX_PATTERNS = 100;
export const SKILL_ALLOWED_TOOL_PATTERN_MAX_LENGTH = 256;

export const SKILL_SUBDIR_MAX_ENTRIES = 1_000;
// load_skill merges references/, resources/, and assets/ into one read-only
// capability list, so its aggregate budget is three bounded subdirectories.
export const SKILL_LOADABLE_REFERENCE_MAX_ENTRIES = SKILL_SUBDIR_MAX_ENTRIES * 3;
export const SKILL_ALLOWED_SUBDIR_MAX_ENTRIES = 16;
export const SKILL_STEERING_PATH_MAX_ENTRIES = 16;
export const SKILL_PATH_SEGMENT_MAX_LENGTH = 255;
export const SKILL_VISIBLE_ERROR_MAX_IDS = 30;
export const SKILL_RUNTIME_AVAILABLE_TOOL_MAX_ENTRIES = 1_000;

export const SKILL_SCRIPT_DEFAULT_TIMEOUT_MS = 60_000;
export const SKILL_SCRIPT_MAX_TIMEOUT_MS = 300_000;
export const SKILL_SCRIPT_MAX_OUTPUT_BYTES = 1_048_576;
export const SKILL_SCRIPT_MAX_CONTENT_BYTES = 1_048_576;
export const SKILL_SCRIPT_MAX_ARGS = 64;
export const SKILL_SCRIPT_MAX_ARG_LENGTH = 4_096;
export const SKILL_SCRIPT_MAX_ARG_BYTES_TOTAL = 65_536;
export const SKILL_SCRIPT_MAX_ENV_ENTRIES = 64;
export const SKILL_SCRIPT_MAX_ENV_KEY_LENGTH = 128;
export const SKILL_SCRIPT_MAX_ENV_VALUE_LENGTH = 8_192;
export const SKILL_SCRIPT_MAX_ENV_BYTES_TOTAL = 65_536;
export const SKILL_SCRIPT_ENV_KEY_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;
