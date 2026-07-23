export const MAX_EXTENSION_NAME_LENGTH = 214;
export const MAX_EXTENSION_VERSION_LENGTH = 128;
export const MAX_CONTRACT_NAME_LENGTH = 128;
export const MAX_CAPABILITY_TYPE_LENGTH = 128;

// Reject control, invisible format, and Unicode line-separator characters.
// These values are embedded in lifecycle logs and error messages, so allowing
// them would make otherwise valid identifiers capable of forging output.
const UNSAFE_IDENTIFIER_CHARACTER = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

export function hasControlCharacters(value: string): boolean {
  return UNSAFE_IDENTIFIER_CHARACTER.test(value);
}

export function hasAsciiWhitespaceOrControlCharacters(value: string): boolean {
  if (hasControlCharacters(value)) return true;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 0x20) return true;
  }
  return false;
}

export function identifierIssue(value: unknown, maximumLength: number): string | undefined {
  if (typeof value !== "string" || value.length === 0) {
    return "must be a non-empty string";
  }
  if (value.length > maximumLength) {
    return `must contain at most ${maximumLength} characters`;
  }
  if (value.trim() !== value) {
    return "must not have leading or trailing whitespace";
  }
  if (hasControlCharacters(value)) {
    return "must not contain control characters";
  }
  return undefined;
}
