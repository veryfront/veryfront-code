/** Process-local state reset registration for caches and singletons. */

const MAX_STATE_RESET_HANDLERS = 256;
const MAX_STATE_RESET_LABEL_LENGTH = 128;

/** Callback that resets one process-local state owner. */
export type ProcessStateResetHandler = () => void | Promise<void>;

/** Contained failure returned after running a registered reset handler. */
export interface ProcessStateResetFailure {
  /** Stable owner label for the failed reset. */
  readonly label: string;
  /** Original failure for internal diagnostics. */
  readonly error: unknown;
}

interface RegisteredStateReset {
  readonly token: symbol;
  readonly label: string;
  readonly handler: ProcessStateResetHandler;
}

function assertResetLabel(label: unknown): asserts label is string {
  if (
    typeof label !== "string" || label.length === 0 ||
    label.length > MAX_STATE_RESET_LABEL_LENGTH ||
    [...label].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    })
  ) {
    throw new TypeError("State reset label must be a bounded string without control characters");
  }
}

/** Bounded registry for process-local reset handlers. */
export class ProcessStateResetRegistry {
  readonly #handlers = new Map<string, RegisteredStateReset>();

  /** Register or replace one labeled state owner and return an ownership-safe unregister callback. */
  register(label: string, handler: ProcessStateResetHandler): () => void {
    assertResetLabel(label);
    if (typeof handler !== "function") {
      throw new TypeError("State reset handler must be a function");
    }
    if (!this.#handlers.has(label) && this.#handlers.size >= MAX_STATE_RESET_HANDLERS) {
      throw new RangeError(
        `State reset registry must not exceed ${MAX_STATE_RESET_HANDLERS} handlers`,
      );
    }

    const token = Symbol(label);
    this.#handlers.set(label, { token, label, handler });
    let registered = true;
    return () => {
      if (!registered) return;
      registered = false;
      if (this.#handlers.get(label)?.token === token) {
        this.#handlers.delete(label);
      }
    };
  }

  /** Run a stable snapshot of all handlers and contain individual failures. */
  async run(): Promise<readonly ProcessStateResetFailure[]> {
    const failures: ProcessStateResetFailure[] = [];
    for (const { label, handler } of [...this.#handlers.values()]) {
      try {
        await handler();
      } catch (error) {
        failures.push(Object.freeze({ label, error }));
      }
    }
    return Object.freeze(failures);
  }

  /** Number of handlers currently registered. */
  get size(): number {
    return this.#handlers.size;
  }
}

const processStateResetRegistry = new ProcessStateResetRegistry();

/** Register or replace one labeled process-local state reset handler. */
export function registerProcessStateReset(
  label: string,
  handler: ProcessStateResetHandler,
): () => void {
  return processStateResetRegistry.register(label, handler);
}

/** Run all process-local reset handlers registered by loaded modules. */
export function runProcessStateResets(): Promise<readonly ProcessStateResetFailure[]> {
  return processStateResetRegistry.run();
}
