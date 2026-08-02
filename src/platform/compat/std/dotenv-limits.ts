/** Maximum accepted dotenv file size in UTF-16 code units. */
export const MAX_ENV_FILE_CHARACTERS = 1024 * 1024;
/** Maximum accepted physical lines in one dotenv file. */
export const MAX_ENV_FILE_LINES = 20_000;
/** Maximum accepted assignments in one dotenv file. */
export const MAX_ENV_FILE_VARIABLES = 10_000;
/** Maximum accepted environment-variable key length. */
export const MAX_ENV_KEY_CHARACTERS = 256;
/** Maximum accepted expanded environment-variable value length. */
export const MAX_ENV_VALUE_CHARACTERS = 256 * 1024;
