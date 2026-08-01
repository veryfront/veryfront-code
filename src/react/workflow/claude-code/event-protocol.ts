export {
  admitClaudeCodeEventMessage,
  MAX_CLAUDE_CODE_ARRAY_ITEMS,
  MAX_CLAUDE_CODE_FIELD_LENGTH,
  MAX_CLAUDE_CODE_MESSAGE_BYTES,
} from "#veryfront/workflow/claude-code/wire-protocol.ts";
export type { ClaudeCodeEventAdmission } from "#veryfront/workflow/claude-code/wire-protocol.ts";

/** Maximum retained events in React streaming state. */
export const MAX_CLAUDE_CODE_EVENT_HISTORY = 1_000;
