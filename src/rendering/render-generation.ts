import { SERVICE_OVERLOADED } from "#veryfront/errors";
import { MAX_TIMER_DELAY_MS } from "#veryfront/utils/timer.ts";

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
    if (!Number.isSafeInteger(options.maxConcurrentRenders) || options.maxConcurrentRenders < 1) {
      throw new RangeError("Render generation capacity must be a positive safe integer");
    }
    if (
      !Number.isInteger(options.drainTimeoutMs) || options.drainTimeoutMs < 0 ||
      options.drainTimeoutMs > MAX_TIMER_DELAY_MS
    ) {
      throw new RangeError("Render generation drain timeout is outside the supported range");
    }
    this.#render = options.executor.render.bind(options.executor);
    this.#stop = options.executor.stop.bind(options.executor);
    this.#releaseArtifacts = options.releaseArtifacts.bind(options);
    this.#maxConcurrentRenders = options.maxConcurrentRenders;
    this.#drainTimeoutMs = options.drainTimeoutMs;
  }

  async render(request: Request): Promise<Response> {
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
    };
    try {
      const response = await this.#render(request);
      if (!response.body) {
        finish();
        return response;
      }
      const reader = response.body.getReader();
      let cancelling = false;
      const finishReading = () => {
        finish();
        reader.releaseLock();
      };
      return new Response(
        new ReadableStream<Uint8Array>({
          async pull(controller) {
            try {
              const next = await reader.read();
              if (cancelling) return;
              if (next.done) {
                finishReading();
                controller.close();
              } else controller.enqueue(next.value);
            } catch (error) {
              if (cancelling) return;
              finishReading();
              controller.error(error);
            }
          },
          async cancel(reason) {
            cancelling = true;
            try {
              await reader.cancel(reason);
            } finally {
              finishReading();
            }
          },
        }, { highWaterMark: 0 }),
        {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        },
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
