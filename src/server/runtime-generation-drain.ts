export interface RuntimeGenerationLease {
  /** Release this request/body lease. Safe to call more than once. */
  release(): void;
  /** Register work that may outlive the response returned by this lease. */
  track(work: PromiseLike<unknown>): void;
}

/**
 * Owns request admission and complete settlement for one runtime generation.
 * Work must be registered before its lease is released, which makes the
 * no-new-work point after lease drain deterministic.
 */
export class RuntimeGenerationDrain {
  #accepting = true;
  #activeLeases = 0;
  #backgroundSettlements = new Set<Promise<void>>();
  #leaseDrainPromise?: Promise<void>;
  #resolveLeaseDrain?: () => void;
  #closePromise?: Promise<void>;

  tryAcquire(): RuntimeGenerationLease | undefined {
    if (!this.#accepting) return undefined;
    this.#activeLeases++;

    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this.#activeLeases--;
        if (this.#activeLeases === 0) {
          this.#resolveLeaseDrain?.();
          this.#resolveLeaseDrain = undefined;
        }
      },
      track: (work) => {
        if (released) {
          throw new Error("Cannot register work on a released runtime generation lease");
        }
        const settlement = Promise.resolve(work).then(
          () => undefined,
          () => undefined,
        );
        this.#backgroundSettlements.add(settlement);
        void settlement.then(() => this.#backgroundSettlements.delete(settlement));
      },
    };
  }

  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    this.#accepting = false;
    this.#closePromise = this.#drain();
    return this.#closePromise;
  }

  async #drain(): Promise<void> {
    if (this.#activeLeases > 0) {
      this.#leaseDrainPromise ??= new Promise<void>((resolve) => {
        this.#resolveLeaseDrain = resolve;
      });
      await this.#leaseDrainPromise;
    }

    // Every lease is now released, and registration after release is rejected,
    // so this is the final set of work owned by the generation.
    await Promise.all(this.#backgroundSettlements);
  }
}
