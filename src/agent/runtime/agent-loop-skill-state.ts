import type { Message } from "../types.ts";
import {
  type ActiveSkillState,
  applySkillActivationResult,
  hasSubmittedFormInputResult,
  hydrateActiveSkillStateFromMessages,
  removeFormInputAfterSubmission,
  SUBMITTED_FORM_INPUT_CONTEXT_KEY,
} from "./skill-policy-enforcement.ts";

/**
 * The single owner of the request-scoped active-skill policy for one agent
 * loop attempt: which skill is active, what it permits, and how that
 * changes when a skill activates or a form input is submitted.
 *
 * Mutable and held for the caller's lifetime — construct one per attempt via
 * `hydrate`, mutate it in place as tool results arrive, and never share an
 * instance across concurrent runs. There is deliberately no module-level or
 * static mutable state; `executeAgentLoop` and `executeAgentLoopStreaming`
 * each construct their own instance instead of maintaining separate copies
 * of the same policy transitions.
 */
export class AgentLoopSkillState {
  activeSkillId: ActiveSkillState["activeSkillId"];
  activeSkillPolicy: ActiveSkillState["activeSkillPolicy"];
  activeSkillToolAvailability: ActiveSkillState["activeSkillToolAvailability"];
  activeSkillDelegationOverrides: ActiveSkillState["activeSkillDelegationOverrides"];
  hasSubmittedFormInput: boolean;

  private constructor(hydrated: ActiveSkillState, hasSubmittedFormInput: boolean) {
    this.activeSkillId = hydrated.activeSkillId;
    this.activeSkillPolicy = hydrated.activeSkillPolicy;
    this.activeSkillToolAvailability = hydrated.activeSkillToolAvailability;
    this.activeSkillDelegationOverrides = hydrated.activeSkillDelegationOverrides;
    this.hasSubmittedFormInput = hasSubmittedFormInput;
  }

  /** Hydrate request-scoped skill state from replay history. */
  static hydrate(
    messages: readonly Message[],
    runtimeContext: Record<string, unknown> | undefined,
  ): AgentLoopSkillState {
    const hydrated = hydrateActiveSkillStateFromMessages(messages);
    const hasSubmittedFormInput = hasSubmittedFormInputResult(messages) ||
      runtimeContext?.[SUBMITTED_FORM_INPUT_CONTEXT_KEY] === true;
    return new AgentLoopSkillState(hydrated, hasSubmittedFormInput);
  }

  /** Fold a successful skill-activation tool result into the active policy. */
  applySuccessfulResult(result: unknown): void {
    const next = applySkillActivationResult({
      activeSkillId: this.activeSkillId,
      activeSkillPolicy: this.activeSkillPolicy,
      activeSkillToolAvailability: this.activeSkillToolAvailability,
      activeSkillDelegationOverrides: this.activeSkillDelegationOverrides,
    }, result);
    this.activeSkillId = next.activeSkillId;
    this.activeSkillPolicy = next.activeSkillPolicy;
    this.activeSkillToolAvailability = next.activeSkillToolAvailability;
    this.activeSkillDelegationOverrides = next.activeSkillDelegationOverrides;
  }

  /**
   * Narrow the active policy after a form_input tool result, and record the
   * flag when `submitted` reports the form was actually submitted. Callers
   * pass `submitted` explicitly (each loop determines it from its own
   * tool-result shape via `isSubmittedFormInputExecutionResult`) rather than
   * this method recomputing it.
   */
  markFormInputSubmitted(toolName: string, result: unknown, submitted: boolean): void {
    this.activeSkillPolicy = removeFormInputAfterSubmission(
      toolName,
      result,
      this.activeSkillPolicy,
    );
    if (submitted) {
      this.hasSubmittedFormInput = true;
    }
  }
}
