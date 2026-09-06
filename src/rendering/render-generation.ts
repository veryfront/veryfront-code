import { SERVICE_OVERLOADED } from "#veryfront/errors";
import { MAX_TIMER_DELAY_MS } from "#veryfront/utils/timer.ts";
import { completeOnResponseBodyConsumption } from "#veryfront/platform/compat/http/response-lifecycle.ts";

/** A renderer already bound to one immutable artifact generation. */
export interface RenderGenerationExecutor {
  render(request: Request): Promise<Response>;
  /**
   * Stop execution and settle only when no executor can access the artifacts.
   * Sending a termination signal or closing a listener alone is insufficient.
   * Reject if quiescence cannot be confirmed; repeated calls must be safe.
   */
  stop(): Promise<void>;
}

export interface RenderGenerationOptions {
  executor: RenderGenerationExecutor;
  /** Release this owner's artifact references; retry safely after failure. */
  releaseArtifacts(): Promise<void>;
  /** Explicit admission budget. There is no hidden queue. */
  maxConcurrentRenders: number;
  /** Grace period before stopping unfinished execution. Zero stops immediately. */
  drainTimeoutMs: number;
}

/**
 * Own render admission, response draining, and artifact release as one lifetime.
 *
 * This is not a renderer, process launcher, or security sandbox. The executor
 * supplies rendering and confirmed shutdown; this owner never releases its
 * artifacts before that shutdown succeeds. A pool must separately account for
 * all admitted generations, including ones that are still closing.
 */
export class RenderGeneration {
  readonly #render: RenderGenerationExecutor["render"];
  readonly #stop: RenderGenerationExecutor["stop"];
  readonly #releaseArtifacts: RenderGenerationOptions["releaseArtifacts"];
  readonly #maxConcurrentRenders: number;
  readonly #drainTimeoutMs: number;
  #active = 0;
  #accepting = true;
  #drained?: () => void;
  #drainFinished = false;
  #executorStopped = false;
  #closing?: Promise<void>;

  constructor(options: RenderGenerationOptions) {
    const { maxConcurrentRenders, drainTimeoutMs } = options;
    if (!Number.isSafeInteger(maxConcurrentRenders) || maxConcurrentRenders < 1) {
      throw new RangeError("Render generation capacity must be a positive safe integer");
    }
    if (
      !Number.isInteger(drainTimeoutMs) || drainTimeoutMs < 0 ||
      drainTimeoutMs > MAX_TIMER_DELAY_MS
    ) {
      throw new RangeError("Render generation drain timeout is outside the supported range");
    }
    const { executor, releaseArtifacts } = options;
    this.#render = executor.render.bind(executor);
    this.#stop = executor.stop.bind(executor);
    this.#releaseArtifacts = releaseArtifacts.bind(options);
    this.#maxConcurrentRenders = maxConcurrentRenders;
    this.#drainTimeoutMs = drainTimeoutMs;
  }

  /** Completion callback errors do not change rendering or admission settlement. */
  async render(request: Request, onComplete?: () => void): Promise<Response> {
    request.signal.throwIfAborted();
    if (!this.#accepting) {
      throw SERVICE_OVERLOADED.create({ detail: "Render generation is draining" });
    }
    if (this.#active >= this.#maxConcurrentRenders) {
      throw SERVICE_OVERLOADED.create({ detail: "Render generation capacity is exhausted" });
    }
    this.#active++;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (--this.#active === 0) this.#drained?.();
      try {
        onComplete?.();
      } catch {
        // A completion observer must not replace the render result or stream error.
      }
    };
    try {
      const response = await this.#render(request);
      return completeOnResponseBodyConsumption(
        response,
        finish,
        request.signal,
        { highWaterMark: 0 },
      );
    } catch (error) {
      finish();
      throw error;
    }
  }

  /** Stop admission immediately, then drain, stop execution, and release artifacts. */
  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#accepting = false;
    this.#closing = Promise.resolve().then(() => this.#close()).catch((error) => {
      this.#closing = undefined;
      throw error;
    });
    return this.#closing;
  }

  async #close(): Promise<void> {
    if (!this.#drainFinished) {
      if (this.#active > 0 && this.#drainTimeoutMs > 0) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await new Promise<void>((resolve) => {
            this.#drained = resolve;
            timer = setTimeout(resolve, this.#drainTimeoutMs);
          });
        } finally {
          clearTimeout(timer);
          this.#drained = undefined;
        }
      }
      this.#drainFinished = true;
    }
    if (!this.#executorStopped) {
      await this.#stop();
      this.#executorStopped = true;
    }
    await this.#releaseArtifacts();
  }
}
