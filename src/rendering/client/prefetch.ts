import { prefetchLogger } from "./browser-logger.ts";
import { LinkObserver } from "./prefetch/link-observer.ts";
import { NetworkUtils } from "./prefetch/network-utils.ts";
import { PrefetchQueue } from "./prefetch/prefetch-queue.ts";
import { type ResourceHint, ResourceHintsManager } from "./prefetch/resource-hints.ts";
import {
  PREFETCH_DEFAULT_DELAY_MS,
  PREFETCH_DEFAULT_TIMEOUT_MS,
  PREFETCH_MAX_SIZE_BYTES,
} from "#veryfront/utils";

export type { ResourceHint };

declare global {
  interface Window {
    veryFrontPrefetch?: PrefetchManager;
    __VERYFRONT_PREFETCH__?: PrefetchAutoInitSetting;
  }
}

interface GlobalWithPrefetch {
  veryFrontPrefetch?: PrefetchManager;
  __VERYFRONT_PREFETCH__?: PrefetchAutoInitSetting;
}

export interface PrefetchOptions {
  rootMargin?: string;
  delay?: number;
  maxConcurrent?: number;
  allowedNetworks?: string[];
  maxSize?: number;
  timeout?: number;
}

type PrefetchAutoInitSetting = boolean | PrefetchOptions;

interface ResolvedPrefetchOptions {
  rootMargin: string;
  delay: number;
  maxConcurrent: number;
  allowedNetworks: string[];
  maxSize: number;
  timeout: number;
}

async function readResponseTextWithinLimit(
  response: Response,
  maxBytes: number,
): Promise<string | null> {
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";
  let finished = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        finished = true;
        text += decoder.decode();
        return text;
      }
      if (!value) continue;

      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) return null;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    if (!finished) {
      try {
        await reader.cancel();
      } catch {
        // The body can already be cancelled by a concurrent manager shutdown.
      }
    }
    reader.releaseLock();
  }
}

export class PrefetchManager {
  private readonly options: ResolvedPrefetchOptions;
  private prefetchedUrls = new Set<string>();

  private readonly networkUtils: NetworkUtils;
  private linkObserver: LinkObserver | null = null;
  private readonly resourceHintsManager: ResourceHintsManager;
  private readonly prefetchQueue: PrefetchQueue;
  private initialized = false;
  private destroyed = false;
  private removeNetworkListener: (() => void) | null = null;
  private removeReadyListener: (() => void) | null = null;

  constructor(options: PrefetchOptions = {}) {
    this.options = {
      rootMargin: options.rootMargin ?? "50px",
      delay: options.delay ?? PREFETCH_DEFAULT_DELAY_MS,
      maxConcurrent: options.maxConcurrent ?? 2,
      allowedNetworks: options.allowedNetworks ?? ["4g", "wifi", "ethernet"],
      maxSize: options.maxSize ?? PREFETCH_MAX_SIZE_BYTES,
      timeout: options.timeout ?? PREFETCH_DEFAULT_TIMEOUT_MS,
    };

    this.networkUtils = new NetworkUtils(this.options.allowedNetworks);
    this.resourceHintsManager = new ResourceHintsManager();
    this.prefetchQueue = new PrefetchQueue(
      {
        maxConcurrent: this.options.maxConcurrent,
        maxSize: this.options.maxSize,
        timeout: this.options.timeout,
      },
      this.prefetchedUrls,
    );

    this.prefetchQueue.setResourceCallback((response, url) =>
      this.prefetchPageResources(response, url)
    );
  }

  init(): void {
    if (this.initialized || this.destroyed) return;
    this.initialized = true;
    prefetchLogger.info("Initializing prefetch manager");

    this.removeNetworkListener = this.networkUtils.onNetworkChange(() => this.applyNetworkState());
    this.applyNetworkState();
  }

  initWhenReady(doc: Document = document): void {
    if (this.initialized || this.destroyed || this.removeReadyListener) return;
    if (doc.readyState !== "loading") {
      this.init();
      return;
    }

    const onReady = (): void => {
      this.removeReadyListener?.();
      this.removeReadyListener = null;
      this.init();
    };
    doc.addEventListener("DOMContentLoaded", onReady, { once: true });
    this.removeReadyListener = () => doc.removeEventListener("DOMContentLoaded", onReady);
  }

  private applyNetworkState(): void {
    if (this.destroyed) return;
    if (!this.networkUtils.shouldPrefetch()) {
      prefetchLogger.info("Prefetching disabled due to network conditions");
      this.linkObserver?.destroy();
      this.linkObserver = null;
      this.prefetchQueue.stop();
      return;
    }

    this.prefetchQueue.start();
    if (this.linkObserver) return;
    this.linkObserver = new LinkObserver(
      {
        rootMargin: this.options.rootMargin,
        delay: this.options.delay,
        onLinkVisible: (link) => this.prefetchQueue.prefetchLink(link),
      },
      this.prefetchedUrls,
    );

    this.linkObserver.init();
  }

  private async prefetchPageResources(response: Response, _pageUrl: string): Promise<void> {
    if (this.destroyed) return;
    const html = await readResponseTextWithinLimit(response, this.options.maxSize);
    if (html === null) {
      prefetchLogger.debug("Prefetched response body exceeds the configured size limit");
      return;
    }
    if (this.destroyed) return;
    const hints = this.resourceHintsManager.extractResourceHints(html, this.prefetchedUrls);
    this.resourceHintsManager.applyResourceHints(hints);
  }

  applyResourceHints(hints: ResourceHint[]): void {
    if (this.destroyed) return;
    this.resourceHintsManager.applyResourceHints(hints);
  }

  async prefetch(url: string): Promise<void> {
    if (this.destroyed) return;
    await this.prefetchQueue.prefetch(url);
  }

  static generateResourceHints(route: string, assets: string[]): string {
    return ResourceHintsManager.generateResourceHints(route, assets);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.removeReadyListener?.();
    this.removeReadyListener = null;
    this.removeNetworkListener?.();
    this.removeNetworkListener = null;
    this.linkObserver?.destroy();
    this.linkObserver = null;
    this.prefetchQueue.stop();
    this.resourceHintsManager.clear();
    this.prefetchedUrls.clear();
  }
}

export function initPrefetch(options?: PrefetchOptions): PrefetchManager {
  const prefetchManager = new PrefetchManager(options);
  const global = globalThis as GlobalWithPrefetch;
  global.veryFrontPrefetch?.destroy();
  global.veryFrontPrefetch = prefetchManager;
  prefetchManager.initWhenReady(document);
  return prefetchManager;
}

function resolveAutoInitOptions(): PrefetchOptions | null {
  const setting = (globalThis as GlobalWithPrefetch).__VERYFRONT_PREFETCH__;
  if (!setting) return null;
  if (setting === true) return {};
  if (typeof setting === "object") return setting;
  return null;
}

function shouldAutoInitPrefetch(options: PrefetchOptions | null): options is PrefetchOptions {
  if (!options) return false;
  if (typeof window === "undefined" || typeof document === "undefined") return false;

  const win = window as Window & { __veryfrontSSRStub?: boolean };
  const doc = document as Document & { __veryfrontSSRStub?: boolean };
  if (win.__veryfrontSSRStub || doc.__veryfrontSSRStub) return false;

  if (typeof IntersectionObserver === "undefined") return false;
  if (typeof MutationObserver === "undefined") return false;

  return true;
}

const autoInitOptions = resolveAutoInitOptions();
if (shouldAutoInitPrefetch(autoInitOptions)) initPrefetch(autoInitOptions);
