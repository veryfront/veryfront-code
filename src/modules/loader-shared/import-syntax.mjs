/** Shared lexical fragments for import/export scanners; all groups are non-capturing. */
const BLOCK_COMMENT = String.raw`\/\*[^*]*(?:\*(?!\/)[^*]*)*\*\/`;
// A true end-of-input assertion keeps this unambiguous with the multiline flag.
const LINE_COMMENT = String.raw`\/\/[^\r\n]*(?:\r?\n|(?![\s\S]))`;
const TRIVIA = String.raw`(?:\s|${BLOCK_COMMENT}|${LINE_COMMENT})`;
const QUOTED = String.raw`(?:"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*')`;
const IDENTIFIER_ESCAPE = String.raw`\\u(?:[0-9a-fA-F]{4}|\{[0-9a-fA-F]{1,6}\})`;
const IDENTIFIER = String
  .raw`(?:[\p{ID_Start}$_]|${IDENTIFIER_ESCAPE})(?:[\p{ID_Continue}$\u200c\u200d]|${IDENTIFIER_ESCAPE})*`;
const NAMED = String.raw`\{(?:[^{}"'/]|${QUOTED}|${BLOCK_COMMENT}|${LINE_COMMENT})*\}`;
const NAMESPACE = String.raw`\*${TRIVIA}*as${TRIVIA}+(?:${IDENTIFIER}|${QUOTED})`;

/** Whitespace and comments between JavaScript tokens. */
export const IMPORT_TRIVIA = String.raw`${TRIVIA}*`;
/** A complete binding clause, including TypeScript type imports and re-exports. */
export const IMPORT_BINDINGS = String
  .raw`(?:type${TRIVIA}+)?(?:${IDENTIFIER}(?:${TRIVIA}*,${TRIVIA}*(?:${NAMED}|${NAMESPACE}))?|${NAMED}|${NAMESPACE}|\*)`;
/** A binding clause through the `from` keyword and following trivia. Requires the u flag. */
export const IMPORT_FROM = String.raw`${IMPORT_BINDINGS}${TRIVIA}*from${TRIVIA}*`;
