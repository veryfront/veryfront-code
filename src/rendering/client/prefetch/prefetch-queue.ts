import { prefetchLogger } from "../browser-logger.ts";
import { PREFETCH_QUEUE_MAX_SIZE_BYTES } from "@veryfront/utils/constants/index.ts";

export interface PrefetchQueueOptions {
  maxConcurrent: number;
  maxSize: number;
  timeout: number;
}

type ResourceCallback = (response: Response, url: string) => void | Promise<void>;

const DEFAULT_OPTIONS: PrefetchQueueOptions = {
  maxConcurrent: 4,
  maxSize: PREFETCH_QUEUE_MAX_SIZE_BYTES,
  timeout: 5_000,
};

function isAbortError(error: unknown): boolean {
  return Boolean(
    error && typeof error === "object" && "name" in error &&
      (error as { name?: string }).name === "AbortError",
  );
}

export class PrefetchQueue {
  private options: PrefetchQueueOptions;
  private controllers = new Map<string, AbortController>();
  private prefetchedUrls: Set<string>;
  private concurrent = 0;
  private stopped = false;
  private onResourcesFetched?: ResourceCallback;

  constructor(options: Partial<PrefetchQueueOptions> = {}, prefetchedUrls?: Set<string>) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.prefetchedUrls = prefetchedUrls ?? new Set<string>();
  }

  setResourceCallback(callback: ResourceCallback): void {
    this.onResourcesFetched = callback;
  }

  enqueue(url: string): void {
    void this.prefetch(url);
  }

  has(url: string): boolean {
    return this.prefetchedUrls.has(url) || this.controllers.has(url);
  }

  get size(): number {
    return this.controllers.size;
  }

  clear(): void {
    this.stopAll();
    this.prefetchedUrls.clear();
  }

  start(): void {
    this.stopped = false;
  }

  stop(): void {
    this.stopped = true;
    this.stopAll();
  }

  getQueueSize(): number {
    return this.controllers.size;
  }

  getConcurrentCount(): number {
    return this.concurrent;
  }

  async prefetchLink(link: HTMLAnchorElement): Promise<void> {
    if (this.stopped) {
      return;
    }

    const url = link.href;

    if (!url || this.controllers.has(url) || this.prefetchedUrls.has(url)) {
      return;
    }

    if (this.concurrent >= this.options.maxConcurrent) {
      prefetchLogger.debug?.(`Prefetch queue full, skipping ${url}`);
      return;
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch (_error) {
      prefetchLogger.debug?.(`Invalid prefetch URL ${url}`);
      return;
    }

    const controller = new AbortController();
    this.controllers.set(url, controller);
    this.concurrent += 1;

    const timeoutId = this.options.timeout > 0
      ? setTimeout(() => controller.abort(), this.options.timeout)
      : undefined;

    try {
      const response = await fetch(parsedUrl.toString(), {
        method: "GET",
        signal: controller.signal,
        headers: { "X-Veryfront-Prefetch": "1" },
      });

      if (!response.ok) {
        return;
      }

      if (this.isResponseTooLarge(response)) {
        prefetchLogger.debug?.(`Prefetch too large, skipping ${url}`);
        return;
      }

      this.prefetchedUrls.add(url);

      if (this.onResourcesFetched) {
        try {
          await this.onResourcesFetched(response, url);
        } catch (callbackError) {
          prefetchLogger.error?.(`Prefetch callback failed for ${url}`, callbackError);
        }
      }
    } catch (error) {
      if (!isAbortError(error)) {
        prefetchLogger.error?.(`Failed to prefetch ${url}`, error);
      }
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }

      this.controllers.delete(url);
      this.concurrent = Math.max(0, this.concurrent - 1);
    }
  }

  async prefetch(url: string): Promise<void> {
    const link = (typeof document !== "undefined")
      ? document.createElement("a")
      : ({ href: url } as HTMLAnchorElement);

    link.href = url;
    await this.prefetchLink(link);
  }

  stopAll(): void {
    for (const controller of this.controllers.values()) {
      controller.abort();
    }

    this.controllers.clear();
    this.concurrent = 0;
  }

  private isResponseTooLarge(response: Response): boolean {
    const rawLength = response.headers.get("content-length");
    if (rawLength === null) {
      return false;
    }

    const size = Number.parseInt(rawLength, 10);
    if (!Number.isFinite(size)) {
      return false;
    }

    return size > this.options.maxSize;
  }
}

export const prefetchQueue = new PrefetchQueue();

export default prefetchQueue;
