/**
 * SSR Browser Globals
 *
 * Provides minimal browser API stubs for SSR to prevent crashes when
 * third-party libraries check for browser features during server rendering.
 *
 * These are NOT full implementations - just enough to not throw errors.
 * Components should still use proper guards (typeof window !== 'undefined')
 * for any actual browser functionality.
 */

// Track if globals have been set up
let ssrGlobalsInitialized = false;

/**
 * Minimal document stub for SSR
 * Handles common feature detection patterns like:
 * - 'exitFullscreen' in document
 * - document.createElement
 * - document.querySelector
 */
const createDocumentStub = () => ({
  // Fullscreen API (video.js, etc.)
  exitFullscreen: undefined,
  webkitExitFullscreen: undefined,
  mozCancelFullScreen: undefined,
  msExitFullscreen: undefined,
  fullscreenElement: null,
  webkitFullscreenElement: null,
  mozFullScreenElement: null,
  msFullscreenElement: null,

  // DOM methods (return null/empty to indicate not found)
  createElement: () => createElementStub(),
  createElementNS: () => createElementStub(),
  createTextNode: () => ({ textContent: "" }),
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementById: () => null,
  getElementsByClassName: () => [],
  getElementsByTagName: () => [],
  getElementsByName: () => [],

  // Document properties
  documentElement: {
    style: {},
    classList: { add: () => {}, remove: () => {}, contains: () => false },
  },
  body: {
    style: {},
    classList: { add: () => {}, remove: () => {}, contains: () => false },
    appendChild: () => {},
  },
  head: { appendChild: () => {}, removeChild: () => {} },
  readyState: "complete",
  cookie: "",
  domain: "",
  referrer: "",
  title: "",
  URL: "",
  location: { href: "", pathname: "/", search: "", hash: "" },

  // Event handling (no-op)
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,

  // Style/CSS
  styleSheets: [],
  adoptedStyleSheets: [],
});

/**
 * Minimal element stub
 */
const createElementStub = () => ({
  style: {},
  classList: { add: () => {}, remove: () => {}, contains: () => false, toggle: () => false },
  dataset: {},
  setAttribute: () => {},
  getAttribute: () => null,
  removeAttribute: () => {},
  hasAttribute: () => false,
  appendChild: () => {},
  removeChild: () => {},
  insertBefore: () => {},
  replaceChild: () => {},
  cloneNode: () => createElementStub(),
  addEventListener: () => {},
  removeEventListener: () => {},
  querySelector: () => null,
  querySelectorAll: () => [],
  getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
  offsetWidth: 0,
  offsetHeight: 0,
  scrollWidth: 0,
  scrollHeight: 0,
  clientWidth: 0,
  clientHeight: 0,
  innerHTML: "",
  outerHTML: "",
  textContent: "",
  innerText: "",
  children: [],
  childNodes: [],
  parentNode: null,
  parentElement: null,
  nextSibling: null,
  previousSibling: null,
  firstChild: null,
  lastChild: null,
});

/**
 * Minimal window stub for SSR
 */
const createWindowStub = () => ({
  // Common properties
  document: createDocumentStub(),
  navigator: {
    userAgent: "SSR",
    language: "en-US",
    languages: ["en-US"],
    platform: "SSR",
    vendor: "",
    onLine: true,
    cookieEnabled: false,
    mediaDevices: { getUserMedia: () => Promise.reject(new Error("SSR")) },
  },
  location: {
    href: "",
    pathname: "/",
    search: "",
    hash: "",
    origin: "",
    protocol: "https:",
    host: "",
    hostname: "",
    port: "",
    assign: () => {},
    replace: () => {},
    reload: () => {},
  },
  history: {
    length: 0,
    state: null,
    pushState: () => {},
    replaceState: () => {},
    go: () => {},
    back: () => {},
    forward: () => {},
  },

  // Dimensions (common for responsive checks)
  innerWidth: 1024,
  innerHeight: 768,
  outerWidth: 1024,
  outerHeight: 768,
  screenX: 0,
  screenY: 0,
  pageXOffset: 0,
  pageYOffset: 0,
  scrollX: 0,
  scrollY: 0,
  devicePixelRatio: 1,

  // Timers (use real implementations if available)
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
  setInterval: globalThis.setInterval,
  clearInterval: globalThis.clearInterval,
  requestAnimationFrame: (cb: () => void) => globalThis.setTimeout(cb, 16),
  cancelAnimationFrame: globalThis.clearTimeout,

  // Storage (no-op)
  localStorage: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
    length: 0,
    key: () => null,
  },
  sessionStorage: {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
    clear: () => {},
    length: 0,
    key: () => null,
  },

  // Events
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,

  // Media queries
  matchMedia: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  }),

  // Misc
  getComputedStyle: () => ({
    getPropertyValue: () => "",
  }),
  getSelection: () => null,
  print: () => {},
  alert: () => {},
  confirm: () => false,
  prompt: () => null,
  open: () => null,
  close: () => {},
  focus: () => {},
  blur: () => {},
  scroll: () => {},
  scrollTo: () => {},
  scrollBy: () => {},
  resizeTo: () => {},
  resizeBy: () => {},
  moveTo: () => {},
  moveBy: () => {},

  // Crypto (basic stub)
  crypto: globalThis.crypto,

  // Performance
  performance: globalThis.performance,

  // fetch is available in Deno
  fetch: globalThis.fetch,

  // URL/URLSearchParams are available in Deno
  URL: globalThis.URL,
  URLSearchParams: globalThis.URLSearchParams,

  // TextEncoder/Decoder are available in Deno
  TextEncoder: globalThis.TextEncoder,
  TextDecoder: globalThis.TextDecoder,
});

/**
 * Create a stub class for DOM element types.
 * Used by libraries like framer-motion that check instanceof.
 */
// deno-lint-ignore no-explicit-any
function createElementClass(name: string): any {
  // Create a named class for better debugging
  const ElementClass = class {};
  Object.defineProperty(ElementClass, "name", { value: name });
  return ElementClass;
}

/**
 * Set up browser globals for SSR
 * Safe to call multiple times - only initializes once
 */
export function setupSSRGlobals(): void {
  if (ssrGlobalsInitialized) return;

  // Only set up if we're in a server environment (no existing window)
  if (typeof globalThis.window !== "undefined" && typeof globalThis.document !== "undefined") {
    // Already have browser globals, don't override
    return;
  }

  const windowStub = createWindowStub();

  // Set globals
  (globalThis as Record<string, unknown>).window = windowStub;
  (globalThis as Record<string, unknown>).document = windowStub.document;
  (globalThis as Record<string, unknown>).navigator = windowStub.navigator;
  (globalThis as Record<string, unknown>).location = windowStub.location;
  (globalThis as Record<string, unknown>).history = windowStub.history;
  (globalThis as Record<string, unknown>).localStorage = windowStub.localStorage;
  (globalThis as Record<string, unknown>).sessionStorage = windowStub.sessionStorage;
  (globalThis as Record<string, unknown>).matchMedia = windowStub.matchMedia;
  (globalThis as Record<string, unknown>).getComputedStyle = windowStub.getComputedStyle;
  (globalThis as Record<string, unknown>).requestAnimationFrame = windowStub.requestAnimationFrame;
  (globalThis as Record<string, unknown>).cancelAnimationFrame = windowStub.cancelAnimationFrame;

  // Self-reference
  (globalThis as Record<string, unknown>).self = windowStub;

  // DOM Element classes - needed by framer-motion and other animation libraries
  // These check `instanceof SVGElement` etc to determine element types
  if (typeof globalThis.Element === "undefined") {
    (globalThis as Record<string, unknown>).Element = createElementClass("Element");
  }
  if (typeof globalThis.HTMLElement === "undefined") {
    (globalThis as Record<string, unknown>).HTMLElement = createElementClass("HTMLElement");
  }
  if (typeof globalThis.SVGElement === "undefined") {
    (globalThis as Record<string, unknown>).SVGElement = createElementClass("SVGElement");
  }
  if (typeof globalThis.Node === "undefined") {
    (globalThis as Record<string, unknown>).Node = createElementClass("Node");
  }
  if (typeof globalThis.Text === "undefined") {
    (globalThis as Record<string, unknown>).Text = createElementClass("Text");
  }
  if (typeof globalThis.Comment === "undefined") {
    (globalThis as Record<string, unknown>).Comment = createElementClass("Comment");
  }
  if (typeof globalThis.DocumentFragment === "undefined") {
    (globalThis as Record<string, unknown>).DocumentFragment = createElementClass(
      "DocumentFragment",
    );
  }

  ssrGlobalsInitialized = true;
}

// Track SSR server port and project domain for fetch rewriting
let ssrServerPort: number | null = null;
let ssrProjectDomain: string | null = null;
let ssrClientOnlyFetching = false; // When true, API fetches don't complete during SSR
const originalFetch = globalThis.fetch;

/**
 * Set the SSR server port for fetch URL rewriting.
 * Called by the dev server when starting.
 */
export function setSSRServerPort(port: number): void {
  ssrServerPort = port;
}

/**
 * Set the current project domain for fetch URL rewriting.
 * Called during SSR request handling.
 */
export function setSSRProjectDomain(domain: string | null): void {
  ssrProjectDomain = domain;
}

/**
 * Enable client-only fetching mode.
 * When enabled, API fetches (starting with /api/) during SSR return
 * promises that never resolve, causing React Query to suspend and
 * render fallbacks. This prevents hydration mismatches.
 */
export function enableSSRClientOnlyFetching(): void {
  ssrClientOnlyFetching = true;
}

/**
 * Disable client-only fetching mode.
 */
export function disableSSRClientOnlyFetching(): void {
  ssrClientOnlyFetching = false;
}

/**
 * Rewrite fetch URL for SSR.
 * - Handles relative URLs (starting with /) by prepending localhost
 * - Redirects requests to the project's own domain to the local server
 */
function rewriteFetchUrlForSSR(url: string): string {
  if (!ssrServerPort) return url;

  // Handle relative URLs (e.g., "/api/articles-2")
  // These need an absolute base URL during SSR
  if (url.startsWith("/")) {
    return `http://localhost:${ssrServerPort}${url}`;
  }

  try {
    const parsed = new URL(url);

    // Rewrite if hostname matches the current project domain (set via setSSRProjectDomain)
    // This handles all project domains dynamically without hardcoding specific domains
    if (ssrProjectDomain && parsed.hostname === ssrProjectDomain) {
      return `http://localhost:${ssrServerPort}${parsed.pathname}${parsed.search}`;
    }

    // Also check for www variant of the project domain
    if (ssrProjectDomain && parsed.hostname === `www.${ssrProjectDomain}`) {
      return `http://localhost:${ssrServerPort}${parsed.pathname}${parsed.search}`;
    }
  } catch {
    // Invalid URL, return as-is
  }

  return url;
}

/**
 * Check if a URL is an API endpoint that should be client-only.
 */
function isClientOnlyApiUrl(url: string): boolean {
  // Match /api/* paths (both relative and absolute to localhost)
  if (url.startsWith("/api/")) return true;
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "localhost" && parsed.pathname.startsWith("/api/")) {
      return true;
    }
  } catch {
    // Invalid URL
  }
  return false;
}

/**
 * Create SSR fetch wrapper that rewrites URLs for local development.
 * In client-only mode, API fetches return never-resolving promises
 * to allow React to render Suspense fallbacks.
 */
function createSSRFetch(): typeof fetch {
  return (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let url: string;
    if (typeof input === "string") {
      url = input;
    } else if (input instanceof URL) {
      url = input.toString();
    } else {
      url = input.url;
    }

    const rewrittenUrl = rewriteFetchUrlForSSR(url);

    // In client-only mode, API fetches return empty responses during SSR.
    // React Query will treat this as a successful fetch with empty data.
    // After hydration, the client will refetch with actual data.
    if (ssrClientOnlyFetching && isClientOnlyApiUrl(rewrittenUrl)) {
      // Return a mock empty response - this prevents the Invalid URL error
      // and allows SSR to complete. React Query will refetch client-side.
      return Promise.resolve(
        new Response(JSON.stringify({ data: [], _ssrSkipped: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }

    if (rewrittenUrl !== url) {
      // Create new request with rewritten URL
      if (typeof input === "string" || input instanceof URL) {
        return originalFetch(rewrittenUrl, init);
      } else {
        // Clone request with new URL
        return originalFetch(new Request(rewrittenUrl, input), init);
      }
    }

    return originalFetch(input, init);
  };
}

/**
 * Enable SSR fetch interception.
 * Replaces globalThis.fetch with a wrapper that rewrites URLs.
 */
export function enableSSRFetchInterception(): void {
  if (!ssrServerPort) return;
  (globalThis as Record<string, unknown>).fetch = createSSRFetch();
}

/**
 * Disable SSR fetch interception.
 * Restores the original fetch.
 */
export function disableSSRFetchInterception(): void {
  (globalThis as Record<string, unknown>).fetch = originalFetch;
}

/**
 * Check if SSR globals are active
 */
export function isSSRGlobalsActive(): boolean {
  return ssrGlobalsInitialized;
}
