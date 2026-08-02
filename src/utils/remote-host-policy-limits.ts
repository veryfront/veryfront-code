import { MAX_URL_LENGTH_FOR_VALIDATION } from "./constants/limits.ts";

/** Maximum number of origins admitted by one remote-import policy. */
export const MAX_REMOTE_HOST_COUNT = 128;

/** Maximum length of one configured remote-import URL. */
export const MAX_REMOTE_HOST_URL_LENGTH = MAX_URL_LENGTH_FOR_VALIDATION;
