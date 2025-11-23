// Fallback Veryfront Router
globalThis.VeryfrontRouter = class {
  constructor(options = {}) {
    this.cache = new Map();
    this.baseUrl = options.baseUrl || "";
    this.onError = options.onError || console.error;
  }

  async navigate(path) {
    console.log("[Router] Navigating to:", path);

    // Check cache first
    if (this.cache.has(path)) {
      console.log("[Router] Found in cache");
      return;
    }

    // Try to load page data
    try {
      const response = await fetch(`/_veryfront/data${path}.json`);
      if (response.ok) {
        const data = await response.json();
        this.cache.set(path, data);

        // Update the page
        globalThis.history.pushState({}, "", path);

        // Simple content update (in real app, would re-render React)
        const root = document.getElementById("root");
        if (root && data.html) {
          root.innerHTML = data.html;
        }
      } else {
        // Fallback to full page load
        globalThis.location.href = path;
      }
    } catch (error) {
      this.onError(error);
      globalThis.location.href = path;
    }
  }

  handleClick(event) {
    const link = event.target.closest("a");
    if (link?.href?.startsWith(globalThis.location.origin)) {
      event.preventDefault();
      const url = new URL(link.href);
      this.navigate(url.pathname);
    }
  }

  prefetch(url) {
    // Basic prefetching
    if (!this.cache.has(url)) {
      fetch(`/_veryfront/data${url}.json`)
        .then((res) => res.json())
        .then((data) => this.cache.set(url, data))
        .catch(() => {});
    }
  }
};
