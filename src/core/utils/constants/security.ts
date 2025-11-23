export const MAX_PATH_TRAVERSAL_DEPTH = 10;

export const FORBIDDEN_PATH_PATTERNS = [
  /\0/, // Null bytes
];

export const DIRECTORY_TRAVERSAL_PATTERN = /\.\.[\/\\]/;

export const ABSOLUTE_PATH_PATTERN = /^[\/\\]/;

export const MAX_PATH_LENGTH = 4096;

export const DEFAULT_MAX_STRING_LENGTH = 1000;
