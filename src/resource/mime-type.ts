/** Shared validation for MCP resource media-type declarations. */

import { containsControlCharacter } from "./string-validation.ts";

export const RESOURCE_MIME_TYPE_MAX_LENGTH = 255;

const RESOURCE_MIME_TYPE_PATTERN =
  /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+(?: *; *[A-Za-z0-9!#$&^_.+-]+ *= *(?:"[^"]*"|[A-Za-z0-9!#$&^_.+-]+))*$/;

/** Whether a value is a bounded media type without folding or controls. */
export function isValidResourceMimeType(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= RESOURCE_MIME_TYPE_MAX_LENGTH &&
    value === value.trim() &&
    !containsControlCharacter(value) &&
    RESOURCE_MIME_TYPE_PATTERN.test(value);
}
