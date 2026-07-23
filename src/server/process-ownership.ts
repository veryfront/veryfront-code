/**
 * Exclusive ownership for process-global lifecycle resources.
 *
 * Veryfront's extension registry, telemetry shims, SSR globals, and monitoring
 * state are process-wide. This guard makes that constraint explicit instead
 * of letting a second live owner silently dismantle the first.
 *
 * @module server/process-ownership
 */

/** A small, generation-safe exclusive ownership guard. */
export class ExclusiveProcessOwner {
  private activeOwner: symbol | undefined;

  constructor(private readonly resourceName: string) {}

  /** Acquire ownership, returning an idempotent generation-owned release. */
  acquire(): () => void {
    if (this.activeOwner !== undefined) {
      throw new Error(
        `A ${this.resourceName} is already active in this process. ` +
          "Dispose it before creating another.",
      );
    }

    const owner = Symbol(this.resourceName);
    this.activeOwner = owner;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (this.activeOwner === owner) this.activeOwner = undefined;
    };
  }
}
