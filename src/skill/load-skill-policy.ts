/**
 * Orchestration contract for the `load_skill` tool.
 *
 * Two tools expose `load_skill`: the standalone one built by
 * `createLoadSkillTool` (used by the `agent()` factory) and the hosted one
 * built by `createRuntimeLoadSkillTool`. Their mechanics differ — only the
 * hosted tool takes a `file` parameter — but the behavioural contract must
 * not, or an agent's behaviour would depend on which runtime happened to
 * register the tool.
 *
 * These clauses live here, in `src/skill`, because `src/agent` may import from
 * `src/skill` but not the reverse. `src/agent/conversation/delegation-policy.ts`
 * re-exports them so agent-side callers keep a single import site.
 *
 * They belong in the tool description rather than a prompt block: the
 * description is always sent, while a prompt block can be replaced by an agent
 * that authors its own. See veryfront/veryfront-issue-inbox#5.
 *
 * @module
 */

/** Keep the visible answer owned by the root assistant, not a delegate. */
export const KEEP_ROOT_ASSISTANT_VISIBLE_OWNER = "Keep the root assistant visibly owning the work.";

/** Delegation is a cost; take it only when it buys something. */
export const DELEGATE_ONLY_WHEN_MATERIALLY_HELPFUL =
  "Delegate only when isolation, parallelism, or a different tool/model budget materially helps.";

/** Loading a skill is not doing the work; the turn continues. */
export const LOAD_SKILL_CONTINUE_SAME_TURN = "Continue the same turn after calling it.";

/**
 * A skill's model/thinking/maxSteps only take effect if the caller forwards
 * them.
 *
 * Deliberately NOT part of the shared clauses: only the hosted loader returns
 * those fields. `createLoadSkillTool` returns `{ skillId, instructions,
 * references, scripts }`, so telling a factory-built agent to forward returned
 * overrides would name fields its `load_skill` never produces.
 *
 * The `invoke_agent` condition is load-bearing, not incidental. Overrides are
 * applied only to that tool (`applySkillDelegationOverridesToToolInput` returns
 * its input unchanged for any other tool name), and scoped `agent_<id>`
 * delegates accept only `{ input }` (`AgentToolInput`), so they cannot carry
 * model/thinking/maxSteps at all. Phrasing the clause conditionally keeps it
 * accurate on runs where `invoke_agent` is absent, without needing a dynamic
 * description.
 */
export const LOAD_SKILL_OVERRIDE_FORWARDING =
  "If invoke_agent is available, pass through any returned model, thinking, or maxSteps overrides when delegating to it.";

/**
 * The behavioural contract every `load_skill` tool description must state,
 * appended after that tool's own mechanics.
 *
 * Only clauses that hold for *both* loaders belong here.
 */
export const LOAD_SKILL_POLICY_CLAUSES = [
  LOAD_SKILL_CONTINUE_SAME_TURN,
  KEEP_ROOT_ASSISTANT_VISIBLE_OWNER,
  DELEGATE_ONLY_WHEN_MATERIALLY_HELPFUL,
].join(" ");
