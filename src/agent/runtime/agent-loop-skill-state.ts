import type { Message } from "../types.ts";
import {
  type ActiveSkillState,
  applySkillActivationResult,
  hasSubmittedFormInputResult,
  hydrateActiveSkillStateFromMessages,
  SUBMITTED_FORM_INPUT_CONTEXT_KEY,
} from "./skill-policy-enforcement.ts";

/**
 * The single owner of the request-scoped active-skill state for one agent loop
 * attempt: which skill is active, which of its files are advertised, and how
 * that changes when a skill activates or a form input is submitted.
 *
 * Construct one instance per attempt via `hydrate`. Mutate it in place as tool
 * results arrive. Never share an instance across concurrent runs. This module
 * holds no module-level or static mutable state. `executeAgentLoop` and
 * `executeAgentLoopStreaming` each construct their own instance instead of
 * maintaining separate copies of the same transitions.
 */
export class AgentLoopSkillState {
  activeSkillId: ActiveSkillState["activeSkillId"];
  activeSkillToolAvailability: ActiveSkillState["activeSkillToolAvailability"];
  activeSkillDelegationOverrides: ActiveSkillState["activeSkillDelegationOverrides"];
  hasSubmittedFormInput: boolean;

  private constructor(hydrated: ActiveSkillState, hasSubmittedFormInput: boolean) {
    this.activeSkillId = hydrated.activeSkillId;
    this.activeSkillToolAvailability = hydrated.activeSkillToolAvailability;
    this.activeSkillDelegationOverrides = hydrated.activeSkillDelegationOverrides;
    this.hasSubmittedFormInput = hasSubmittedFormInput;
  }

  /**
   * Hydrate request-scoped skill state from replay history.
   *
   * Replayed messages are caller-supplied, so hydration never carries
   * delegation overrides; those require a load_skill result this runtime
   * produced via `applySuccessfulResult`.
   */
  static hydrate(
    messages: readonly Message[],
    runtimeContext: Record<string, unknown> | undefined,
  ): AgentLoopSkillState {
    const hydrated = hydrateActiveSkillStateFromMessages(messages);
    const hasSubmittedFormInput = hasSubmittedFormInputResult(messages) ||
      runtimeContext?.[SUBMITTED_FORM_INPUT_CONTEXT_KEY] === true;
    return new AgentLoopSkillState(hydrated, hasSubmittedFormInput);
  }

  /**
   * Fold a successful skill-activation tool result into the active skill state.
   *
   * Callers pass only the output of a load_skill call this runtime executed, so
   * this is the one path allowed to seed delegation overrides.
   */
  applySuccessfulResult(result: unknown): void {
    const next = applySkillActivationResult(
      {
        activeSkillId: this.activeSkillId,
        activeSkillToolAvailability: this.activeSkillToolAvailability,
        activeSkillDelegationOverrides: this.activeSkillDelegationOverrides,
      },
      result,
      { trustDelegationOverrides: true },
    );
    this.activeSkillId = next.activeSkillId;
    this.activeSkillToolAvailability = next.activeSkillToolAvailability;
    this.activeSkillDelegationOverrides = next.activeSkillDelegationOverrides;
  }

  /**
   * Record that a form_input result reported an actual submission. Callers
   * compute `submitted` with a broader predicate than this class applies
   * internally; they can disagree, so the flag cannot be recomputed here
   * without changing behavior.
   */
  markFormInputSubmitted(submitted: boolean): void {
    if (submitted) {
      this.hasSubmittedFormInput = true;
    }
  }
}
