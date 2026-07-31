import { MAX_CSS_SELECTOR_TOKEN_CHARACTERS, MAX_CSS_SELECTOR_TOKENS } from "./constants/css.ts";

const whitespacePattern = /\s/u;

function containsWhitespaceOrControl(value: string): boolean {
  if (whitespacePattern.test(value)) return true;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (
      code <= 0x1f ||
      (code >= 0x7f && code <= 0x9f)
    ) {
      return true;
    }
  }
  return false;
}

/** Validate one provider-neutral class/selector candidate token. */
export function assertCSSCandidateToken(
  value: unknown,
  label = "CSS candidate",
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_CSS_SELECTOR_TOKEN_CHARACTERS ||
    containsWhitespaceOrControl(value)
  ) {
    throw new TypeError(
      `${label} must be a non-empty token of at most ${MAX_CSS_SELECTOR_TOKEN_CHARACTERS} characters without whitespace or control characters`,
    );
  }
  return value;
}

/** Snapshot, validate, and deduplicate compiler candidate input. */
export function normalizeCSSCandidates(
  value: unknown,
  label = "CSS candidates",
): string[] {
  if (!Array.isArray(value) && !(value instanceof Set)) {
    throw new TypeError(`${label} must be an array or Set`);
  }
  const inputSize = Array.isArray(value) ? value.length : value.size;
  if (inputSize > MAX_CSS_SELECTOR_TOKENS) {
    throw new TypeError(`${label} cannot exceed ${MAX_CSS_SELECTOR_TOKENS} candidates`);
  }

  const candidates = new Set<string>();
  for (const rawCandidate of value) {
    const candidate = assertCSSCandidateToken(rawCandidate, label);
    if (!candidates.has(candidate) && candidates.size >= MAX_CSS_SELECTOR_TOKENS) {
      throw new TypeError(`${label} cannot exceed ${MAX_CSS_SELECTOR_TOKENS} candidates`);
    }
    candidates.add(candidate);
  }
  return [...candidates];
}
