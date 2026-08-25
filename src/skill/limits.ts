/**
 * Internal resource and boundary limits for the skill subsystem.
 *
 * Keep shared limits here so schemas, direct APIs, discovery, and execution
 * cannot drift into enforcing different budgets.
 */

const apply = Reflect.apply;
const NativeRegExp = RegExp;
const regExpExec = RegExp.prototype.exec;

export const SKILL_ID_MAX_LENGTH = 256;
export const SKILL_ROOT_PATH_MAX_LENGTH = 4_096;
export const SKILL_RELATIVE_PATH_MAX_LENGTH = 1_024;
export const SKILL_DOCUMENT_MAX_CHARACTERS = 1_048_576;
export const SKILL_TEXT_FILE_MAX_BYTES = 1_048_576;

export const SKILL_ALLOWED_TOOL_MAX_PATTERNS = 100;
export const SKILL_ALLOWED_TOOL_PATTERN_MAX_LENGTH = 256;

export const SKILL_SUBDIR_MAX_ENTRIES = 1_000;
export const SKILL_SELECTOR_MAX_DEFINITIONS = SKILL_SUBDIR_MAX_ENTRIES;
export const SKILL_SELECTOR_MAX_ENTRIES = SKILL_SUBDIR_MAX_ENTRIES;
// load_skill merges references/, resources/, and assets/ into one read-only
// capability list, so its aggregate budget is three bounded subdirectories.
export const SKILL_LOADABLE_REFERENCE_MAX_ENTRIES = SKILL_SUBDIR_MAX_ENTRIES * 3;
// A directory listing also contains its SKILL.md definition. Keep the
// transport/list snapshot large enough for the complete readable-file
// capability set without counting that definition as a readable file.
export const SKILL_LOADABLE_REFERENCE_LISTING_MAX_ENTRIES = SKILL_LOADABLE_REFERENCE_MAX_ENTRIES +
  1;
export const SKILL_RUNTIME_LOADED_SKILL_CACHE_MAX_ENTRIES = SKILL_SUBDIR_MAX_ENTRIES;
export const SKILL_RUNTIME_LOADED_REFERENCE_CACHE_MAX_ENTRIES =
  SKILL_LOADABLE_REFERENCE_MAX_ENTRIES;
export const SKILL_ALLOWED_SUBDIR_MAX_ENTRIES = 16;
export const SKILL_STEERING_PATH_MAX_ENTRIES = 16;
export const SKILL_PATH_SEGMENT_MAX_LENGTH = 255;
export const SKILL_VISIBLE_ERROR_MAX_IDS = 30;
export const SKILL_RUNTIME_AVAILABLE_TOOL_MAX_ENTRIES = 1_000;
/** Aggregate limits for one retained runtime skill catalog. */
export const SKILL_CATALOG_MAX_SKILLS = 128;
export const SKILL_CATALOG_MAX_DOCUMENT_CHARACTERS = 8 * 1_048_576;
export const SKILL_CATALOG_MAX_DOCUMENT_UTF8_BYTES = 16 * 1_048_576;
// One skill may legitimately advertise the full three-directory readable-file
// budget. Keep enough aggregate space for that catalog member plus one source
// path for every retained definition, while still bounding total path memory.
export const SKILL_CATALOG_MAX_PATH_ENTRIES = SKILL_LOADABLE_REFERENCE_MAX_ENTRIES +
  SKILL_CATALOG_MAX_SKILLS;
export const SKILL_CATALOG_MAX_METADATA_CHARACTERS = 1_048_576;
/** One outer deadline for skill discovery/read operations. */
export const SKILL_FILE_OPERATION_TIMEOUT_MS = 30_000;

export const SKILL_SCRIPT_DEFAULT_TIMEOUT_MS = 60_000;
export const SKILL_SCRIPT_MAX_TIMEOUT_MS = 300_000;
/** Maximum cleanup wait after a lifecycle provider receives termination. */
export const SKILL_SCRIPT_PROVIDER_TERMINATION_GRACE_MS = 1_000;
/** Combined UTF-8 byte ceiling for stdout and stderr returned by a skill tool. */
export const SKILL_SCRIPT_MAX_OUTPUT_BYTES = 1_048_576;
export const SKILL_SCRIPT_MAX_CONTENT_BYTES = 1_048_576;
/** Maximum number of text files retained in one executable script snapshot. */
export const SKILL_SCRIPT_SNAPSHOT_MAX_FILES = SKILL_SUBDIR_MAX_ENTRIES;
/** Aggregate UTF-8 ceiling for one executable script snapshot. */
export const SKILL_SCRIPT_SNAPSHOT_MAX_BYTES = 16 * 1_048_576;
export const SKILL_SCRIPT_MAX_ARGS = 64;
export const SKILL_SCRIPT_MAX_ARG_LENGTH = 4_096;
export const SKILL_SCRIPT_MAX_ARG_BYTES_TOTAL = 65_536;
export const SKILL_SCRIPT_MAX_ENV_ENTRIES = 64;
export const SKILL_SCRIPT_MAX_ENV_KEY_LENGTH = 128;
export const SKILL_SCRIPT_MAX_ENV_VALUE_LENGTH = 8_192;
export const SKILL_SCRIPT_MAX_ENV_BYTES_TOTAL = 65_536;

const SKILL_SCRIPT_ENV_KEY_PATTERN_SOURCE = "^[A-Za-z_][A-Za-z0-9_]*$";
const INTERNAL_SKILL_SCRIPT_ENV_KEY_REGEX = new NativeRegExp(
  SKILL_SCRIPT_ENV_KEY_PATTERN_SOURCE,
);

/**
 * Public inspection matcher for skill-script environment names.
 * Mutating this compatibility value does not alter admission decisions.
 */
export const SKILL_SCRIPT_ENV_KEY_REGEX = new NativeRegExp(
  SKILL_SCRIPT_ENV_KEY_PATTERN_SOURCE,
);

/** Framework-owned skill-script environment-name admission check. */
export function isValidSkillScriptEnvironmentKey(value: unknown): value is string {
  return typeof value === "string" &&
    apply(regExpExec, INTERNAL_SKILL_SCRIPT_ENV_KEY_REGEX, [value]) !== null;
}
