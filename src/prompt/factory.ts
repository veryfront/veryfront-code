import type { Prompt, PromptConfig, PromptRenderContext } from "./types.ts";
import { createError, toError } from "#veryfront/errors";
import { assertPromptConfig, snapshotPromptMCPConfig } from "./validation.ts";

const DateNow = Date.now;
const NumberIsFinite = Number.isFinite;
const ObjectFreeze = Object.freeze;
const ObjectPrototypeHasOwnProperty = Object.prototype.hasOwnProperty;
const ReflectApply = Reflect.apply;
const SetTimeout = globalThis.setTimeout;
const ClearTimeout = globalThis.clearTimeout;
const StringConstructor = String;
const StringPrototypeReplace = String.prototype.replace;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

interface PromptCancellation {
  readonly context: Readonly<PromptRenderContext>;
  readonly cancellation: Promise<never>;
  cleanup(): void;
}

/** Create a typed prompt definition. */
export function prompt(config: PromptConfig): Prompt {
  assertPromptConfig(config);
  const { content, description, generate, suggestion } = config;

  const id = config.id ?? generatePromptId();
  const generatedId = config.id === undefined ? id : undefined;

  const created: Prompt = {
    id,
    description,
    suggestion,
    mcp: snapshotPromptMCPConfig(config.mcp),
    async getContent(
      variables?: Record<string, unknown>,
      context?: Readonly<PromptRenderContext>,
    ): Promise<string> {
      const resolvedVariables = variables ?? {};

      if (content !== undefined) {
        assertPromptRenderActive(context);
        return interpolateVariables(content, resolvedVariables);
      }

      if (generate) {
        const cancellation = createPromptCancellation(context);
        try {
          const generatedPromise = Promise.resolve().then(() => {
            if (cancellation) assertPromptRenderActive(cancellation.context);
            return generate(resolvedVariables, cancellation?.context);
          });
          const generated = cancellation
            ? await Promise.race([generatedPromise, cancellation.cancellation])
            : await generatedPromise;
          if (typeof generated !== "string") {
            throw toError(
              createError({
                type: "agent",
                message: `Prompt "${id}" generator must return a string`,
              }),
            );
          }
          return generated;
        } finally {
          cancellation?.cleanup();
        }
      }

      // The factory validates this invariant before returning. Keep the guard
      // local so a future refactor cannot turn a malformed prompt into an
      // advertised runtime value.
      throw new TypeError(`Prompt "${id}" has no content or generator`);
    },
  };
  return generatedId === undefined ? created : { ...created, __veryfrontGeneratedId: generatedId };
}

function createPromptAbortError(): DOMException {
  return new DOMException("Prompt rendering aborted", "AbortError");
}

function createPromptDeadlineError(): DOMException {
  return new DOMException("Prompt rendering deadline exceeded", "TimeoutError");
}

function validatePromptDeadline(deadline: number | undefined): void {
  if (deadline !== undefined && !NumberIsFinite(deadline)) {
    throw new TypeError("Prompt render deadline must be a finite number");
  }
}

function assertPromptRenderActive(context: Readonly<PromptRenderContext> | undefined): void {
  validatePromptDeadline(context?.deadline);
  if (context?.deadline !== undefined && DateNow() >= context.deadline) {
    throw createPromptDeadlineError();
  }
  if (context?.abortSignal?.aborted) {
    throw createPromptAbortError();
  }
}

function createPromptCancellation(
  requested: Readonly<PromptRenderContext> | undefined,
): PromptCancellation | undefined {
  if (requested === undefined) return undefined;

  assertPromptRenderActive(requested);
  const deadline = requested.deadline;
  const outerSignal = requested.abortSignal;
  const controller = deadline === undefined ? undefined : new AbortController();
  const abortSignal = controller?.signal ?? outerSignal;
  const abortFromOuter = () => controller?.abort(createPromptAbortError());
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;

  if (!abortSignal) {
    return {
      context: ObjectFreeze({ deadline }),
      cancellation: new Promise<never>(() => {}),
      cleanup: () => {
        if (deadlineTimer !== undefined) ClearTimeout(deadlineTimer);
        outerSignal?.removeEventListener("abort", abortFromOuter);
      },
    };
  }

  let rejectCancellation: ((reason: DOMException) => void) | undefined;
  const cancellation = new Promise<never>((_resolve, reject) => {
    rejectCancellation = reject;
  });
  const rejectOnAbort = () => {
    const reason = abortSignal.reason;
    rejectCancellation?.(
      controller && reason instanceof DOMException && reason.name === "TimeoutError"
        ? reason
        : createPromptAbortError(),
    );
  };
  abortSignal.addEventListener("abort", rejectOnAbort, { once: true });

  if (controller) {
    if (outerSignal) {
      outerSignal.addEventListener("abort", abortFromOuter, { once: true });
      // An abort that occurred after the initial validation but before listener
      // installation must still reach the derived signal.
      if (outerSignal.aborted) abortFromOuter();
    }
    const scheduleDeadline = () => {
      const remaining = deadline! - DateNow();
      if (remaining <= 0) {
        controller.abort(createPromptDeadlineError());
        return;
      }
      // JavaScript runtimes clamp larger delays, often to one millisecond.
      // Re-arm long deadlines instead of turning them into immediate timeouts.
      deadlineTimer = SetTimeout(
        scheduleDeadline,
        Math.min(remaining, MAX_TIMER_DELAY_MS),
      );
    };
    if (!controller.signal.aborted) scheduleDeadline();
  }

  // AbortSignal does not replay an earlier abort event to later listeners.
  // Cover deadline and caller aborts that race with listener installation.
  if (abortSignal.aborted) rejectOnAbort();

  return {
    context: ObjectFreeze({ abortSignal, deadline }),
    cancellation,
    cleanup: () => {
      abortSignal.removeEventListener("abort", rejectOnAbort);
      outerSignal?.removeEventListener("abort", abortFromOuter);
      if (deadlineTimer !== undefined) ClearTimeout(deadlineTimer);
      rejectCancellation = undefined;
    },
  };
}

let promptIdCounter = 0;

function generatePromptId(): string {
  return `prompt_${DateNow()}_${promptIdCounter++}`;
}

function interpolateVariables(
  template: string,
  variables: Record<string, unknown>,
): string {
  return ReflectApply(StringPrototypeReplace, template, [
    /\{(\w+)\}/g,
    (match: string, key: string) => {
      if (!ReflectApply(ObjectPrototypeHasOwnProperty, variables, [key])) return match;
      const value = variables[key];
      return value != null ? StringConstructor(value) : match;
    },
  ]) as string;
}
