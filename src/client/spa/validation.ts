import { MAX_URL_LENGTH_FOR_VALIDATION } from "#veryfront/utils/constants/limits.ts";

/** Maximum code units accepted for SPA module and page-data resource keys. */
export const MAX_SPA_RESOURCE_KEY_LENGTH = MAX_URL_LENGTH_FOR_VALIDATION;

/** Whether text contains a C0 control character or DEL. */
export function hasControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x1f || codeUnit === 0x7f) return true;
  }
  return false;
}
