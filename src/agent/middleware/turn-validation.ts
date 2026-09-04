/**
 * Turn-validation hooks a middleware can register on its own context.
 *
 * A middleware sees only `context.input`, but the runtime resolves that value
 * further before it persists and dispatches the turn: a later middleware can
 * replace the array or mutate a message in place, and conversation memory can
 * contribute earlier messages that the provider merges with this turn's. Both
 * are visible only to the runtime, so a middleware that needs to inspect the
 * committed shape registers a hook here. The runtime invokes it before the
 * turn is committed and again before dispatch when memory rewrites the shape.
 *
 * The hooks live in this middleware-agnostic module rather than in any one
 * middleware so the runtime depends on the contract, not on an implementation:
 * any middleware can register, and registrations compose.
 *
 * @module agent/middleware/turn-validation
 */

import type { AgentContext, Message } from "#veryfront/agent/types.ts";

/**
 * Validate the resolved post-middleware input for one turn.
 *
 * Receives exactly the messages the runtime is about to persist and dispatch.
 */
export type TurnInputValidator = (messages: Message[]) => Promise<void>;

/**
 * Validate the full provider-bound conversation assembled for one turn.
 *
 * Receives the persisted history and this turn's resolved input separately, so
 * a hook can tell which messages the turn is actually adding. When memory
 * rewrites the transcript during persistence, the runtime passes the complete
 * provider-bound transcript as `turnInput` with empty `history`.
 */
export type TurnMessageValidator = (history: Message[], turnInput: Message[]) => Promise<void>;

const turnInputValidators = new WeakMap<AgentContext, TurnInputValidator>();
const turnMessageValidators = new WeakMap<AgentContext, TurnMessageValidator>();

/**
 * Register a post-middleware input validator for a turn, composing with any
 * validator an earlier middleware registered on the same context.
 */
export function registerTurnInputValidator(
  context: AgentContext,
  validate: TurnInputValidator,
): void {
  const previous = turnInputValidators.get(context);
  turnInputValidators.set(
    context,
    previous
      ? async (messages) => {
        await previous(messages);
        await validate(messages);
      }
      : validate,
  );
}

/** Resolve the post-middleware input validator registered for a turn, if any. */
export function getTurnInputValidator(context: AgentContext): TurnInputValidator | undefined {
  return turnInputValidators.get(context);
}

/**
 * Register a cross-turn conversation validator for a turn, composing with any
 * validator an earlier middleware registered on the same context.
 */
export function registerTurnMessageValidator(
  context: AgentContext,
  validate: TurnMessageValidator,
): void {
  const previous = turnMessageValidators.get(context);
  turnMessageValidators.set(
    context,
    previous
      ? async (history, turnInput) => {
        await previous(history, turnInput);
        await validate(history, turnInput);
      }
      : validate,
  );
}

/** Resolve the cross-turn conversation validator registered for a turn, if any. */
export function getTurnMessageValidator(context: AgentContext): TurnMessageValidator | undefined {
  return turnMessageValidators.get(context);
}
