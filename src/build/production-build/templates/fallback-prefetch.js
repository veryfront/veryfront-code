// Fallback PrefetchManager
globalThis.PrefetchManager = class {
  constructor(options = {}) {
    this.rootMargin = options.rootMargin || "50px";
    this.maxConcurrent = options.maxConcurrent || 2;
    this.prefetched = new Set();
    this.prefetching = new Map();
    this.observer = null;

    // Initialize IntersectionObserver if available
    if (typeof IntersectionObserver !== "undefined") {
      this.observer = new IntersectionObserver(this.handleIntersection.bind(this), {
        rootMargin: this.rootMargin,
      });
    }
  }

  observe(element) {
    if (this.observer && element) {
      this.observer.observe(element);
    }
  }

  unobserve(element) {
    if (this.observer && element) {
      this.observer.unobserve(element);
    }
  }

  handleIntersection(entries) {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        const link = entry.target;
        const href = link.getAttribute("href");
        if (href?.startsWith("/") && !this.prefetched.has(href)) {
          this.prefetch(href);
        }
      }
    });
  }

  async prefetch(url) {
    // Don't prefetch if already done or in progress
    if (this.prefetched.has(url) || this.prefetching.has(url)) {
      return;
    }

    // Check concurrent limit
    if (this.prefetching.size >= this.maxConcurrent) {
      return;
    }

    console.log("[Prefetch] Prefetching:", url);

    const controller = new AbortController();
    this.prefetching.set(url, controller);

    try {
      // Prefetch the HTML page
      const response = await fetch(url, {
        signal: controller.signal,
        credentials: "same-origin",
      });

      if (response.ok) {
        // Also try to prefetch the data
        fetch(`/_veryfront/data${url}.json`, {
          credentials: "same-origin",
        }).catch(() => { /* SILENT: data prefetch is best-effort */ });

        this.prefetched.add(url);
        console.log("[Prefetch] Success:", url);
      }
    } catch (error) {
      if (error.name !== "AbortError") {
        console.warn("[Prefetch] Failed:", url, error);
      }
    } finally {
      this.prefetching.delete(url);
    }
  }

  cancelAll() {
    // Cancel all ongoing prefetches
    this.prefetching.forEach((controller) => controller.abort());
    this.prefetching.clear();
  }
};
