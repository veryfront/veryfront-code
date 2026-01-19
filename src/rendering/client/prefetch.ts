import { prefetchLogger } from "./browser-logger.ts";
import { LinkObserver } from "./prefetch/link-observer.ts";
import { NetworkUtils } from "./prefetch/network-utils.ts";
import { PrefetchQueue } from "./prefetch/prefetch-queue.ts";
import { type ResourceHint, ResourceHintsManager } from "./prefetch/resource-hints.ts";
import {
  PREFETCH_DEFAULT_DELAY_MS,
  PREFETCH_DEFAULT_TIMEOUT_MS,
  PREFETCH_MAX_SIZE_BYTES,
} from "@veryfront/utils";

export type { ResourceHint };

declare global {
  interface Window {
    veryFrontPrefetch?: PrefetchManager;
    __VERYFRONT_PREFETCH__?: PrefetchAutoInitSetting;
  }
}

/** Global interface for prefetch manager */
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

export class PrefetchManager {
  private options: ResolvedPrefetchOptions;
  private prefetchedUrls = new Set<string>();

  private networkUtils: NetworkUtils;
  private linkObserver: LinkObserver | null = null;
  private resourceHintsManager: ResourceHintsManager;
  private prefetchQueue: PrefetchQueue;

  constructor(options: PrefetchOptions = {}) {
    this.options = {
      rootMargin: options.rootMargin || "50px",
      delay: options.delay || PREFETCH_DEFAULT_DELAY_MS,
      maxConcurrent: options.maxConcurrent || 2,
      allowedNetworks: options.allowedNetworks || ["4g", "wifi", "ethernet"],
      maxSize: options.maxSize || PREFETCH_MAX_SIZE_BYTES,
      timeout: options.timeout || PREFETCH_DEFAULT_TIMEOUT_MS,
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
    prefetchLogger.info("Initializing prefetch manager");

    if (!this.networkUtils.shouldPrefetch()) {
      prefetchLogger.info("Prefetching disabled due to network conditions");
      return;
    }

    this.linkObserver = new LinkObserver(
      {
        rootMargin: this.options.rootMargin,
        delay: this.options.delay,
        onLinkVisible: (link) => this.prefetchQueue.prefetchLink(link),
      },
      this.prefetchedUrls,
    );

    this.linkObserver.init();

    this.networkUtils.onNetworkChange(() => {
      if (!this.networkUtils.shouldPrefetch()) {
        this.prefetchQueue.stopAll();
      }
    });
  }

  private async prefetchPageResources(response: Response, _pageUrl: string): Promise<void> {
    const html = await response.text();
    const hints = this.resourceHintsManager.extractResourceHints(html, this.prefetchedUrls);
    this.resourceHintsManager.applyResourceHints(hints);
  }

  applyResourceHints(hints: ResourceHint[]): void {
    this.resourceHintsManager.applyResourceHints(hints);
  }

  async prefetch(url: string): Promise<void> {
    await this.prefetchQueue.prefetch(url);
  }

  static generateResourceHints(route: string, assets: string[]): string {
    return ResourceHintsManager.generateResourceHints(route, assets);
  }

  destroy(): void {
    this.linkObserver?.destroy();
    this.prefetchQueue.stopAll();
    this.prefetchedUrls.clear();
  }
}

export function initPrefetch(options?: PrefetchOptions): PrefetchManager {
  const prefetchManager = new PrefetchManager(options);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => prefetchManager.init());
  } else {
    prefetchManager.init();
  }

  (globalThis as unknown as GlobalWithPrefetch).veryFrontPrefetch = prefetchManager;
  return prefetchManager;
}

function resolveAutoInitOptions(): PrefetchOptions | null {
  const setting = (globalThis as unknown as GlobalWithPrefetch).__VERYFRONT_PREFETCH__;
  if (!setting) return null;
  if (setting === true) return {};
  if (typeof setting === "object") return setting;
  return null;
}

function shouldAutoInitPrefetch(options: PrefetchOptions | null): options is PrefetchOptions {
  if (!options) return false;
  if (typeof window === "undefined" || typeof document === "undefined") return false;
  const win = window as unknown as { __veryfrontSSRStub?: boolean };
  const doc = document as unknown as { __veryfrontSSRStub?: boolean };
  if (win.__veryfrontSSRStub || doc.__veryfrontSSRStub) return false;
  if (typeof IntersectionObserver === "undefined") return false;
  if (typeof MutationObserver === "undefined") return false;
  return true;
}

const autoInitOptions = resolveAutoInitOptions();
if (shouldAutoInitPrefetch(autoInitOptions)) {
  initPrefetch(autoInitOptions);
}
